<?php
/**
 * Multiplayer API.
 * ------------------------------------------------------------------
 * One front controller, JSON in and out, same origin as the game so there is
 * no CORS to configure. Shared hosting has no WebSocket support, so clients
 * poll ?action=state every couple of seconds; that poll doubles as the
 * heartbeat keeping a player marked connected.
 *
 * Routes are selected with ?action=, not path rewriting, so this works on any
 * PHP host with no .htaccess required.
 *
 *   POST ?action=create            -> new game, you are the host
 *   POST ?action=join    {code}    -> take a free slot
 *   GET  ?action=state             -> the lobby, and a heartbeat
 *   POST ?action=party   {partyId}
 *   POST ?action=details {candidateName, slogan, budget}
 *   POST ?action=ready   {ready}
 *   POST ?action=start             -> host only
 *   POST ?action=campaign {actionId, constituency, amount}
 *   POST ?action=loan    {amount}  -> quote with {quote:true}
 *   GET  ?action=history {constituency}
 *   POST ?action=leave
 *   GET  ?action=health
 *   GET  ?action=stats             -> counters, leaderboard, party performance
 *   POST ?action=profile           -> fetch or create a profile
 *   POST ?action=record            -> a finished solo game, self-reported
 *
 * The round clock runs on this side. Every authenticated request settles any
 * rounds whose time has run out before it does anything else, so a client that
 * has been asleep cannot act in a round that finished five minutes ago.
 *
 * Auth: every call after create/join sends playerId + token, issued once and
 * kept by the client so a refresh or a dropped connection can reconnect.
 */
declare(strict_types=1);

require __DIR__ . '/lib/Store.php';
require __DIR__ . '/lib/Code.php';
require __DIR__ . '/lib/Lobby.php';
require __DIR__ . '/lib/Territory.php';
require __DIR__ . '/lib/Alliances.php';
require __DIR__ . '/lib/Campaign.php';
require __DIR__ . '/lib/Rounds.php';
require __DIR__ . '/lib/AI.php';
require __DIR__ . '/lib/Profiles.php';
require __DIR__ . '/lib/Investigation.php';
require __DIR__ . '/lib/Election.php';
require __DIR__ . '/lib/Coalition.php';

/* ---------------------------------------------------------------- config */

const GAME_TTL_SECONDS = 86400;   // a game idle for a day is dropped
const MAX_ACTIVE_GAMES = 500;     // a cheap ceiling on abuse

/* Whatever happens, answer JSON. A fatal that renders as HTML shows up in the
   browser as an unreadable parse error instead of a message. */
ini_set('display_errors', '0');
ini_set('html_errors', '0');

set_exception_handler(function (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    error_log('cmp api: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    echo json_encode([
        'ok' => false,
        'error' => 'The game server hit an unexpected problem.',
        'code' => 'server_error',
    ]);
});

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err === null || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        return;
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'ok' => false,
        'error' => 'The game server hit an unexpected problem.',
        'code' => 'server_error',
    ]);
});

$dataDir = getenv('CMP_DATA_DIR') ?: __DIR__ . '/data';
$store = new FileStore($dataDir);
$campaign = new Campaign(__DIR__ . '/campaign-config.json');
$investigation = new Investigation($campaign);
$election = new Election($campaign);
$coalitionRules = new Coalition($campaign);
$profiles = new Profiles($dataDir, $campaign->config());
$territory = $campaign->territory();

/* The seat list the board is dealt from. Read once from the generated data
   file so the server and browser always agree on which seats exist. */
$constituencyNumbers = (function (): array {
    $js = @file_get_contents(__DIR__ . '/../js/data/constituencies.js');
    if ($js === false) {
        return range(1, 117);
    }
    if (preg_match('/CMP\.CONSTITUENCIES = (\[.*?\]);/s', $js, $m)) {
        $list = json_decode($m[1], true);
        if (is_array($list)) {
            return array_map(static fn($c) => (int) $c['number'], $list);
        }
    }
    return range(1, 117);
})();

/* Sitting MLAs, read from the generated data file so the server and browser
   always agree on who holds which seat. */
$incumbentParties = (function (): array {
    $js = @file_get_contents(__DIR__ . '/../js/data/incumbents.js');
    if ($js === false) {
        return [];
    }
    if (preg_match('/CMP\.INCUMBENTS = (\[.*?\]);/s', $js, $m)) {
        $list = json_decode($m[1], true);
        if (is_array($list)) {
            $map = [];
            foreach ($list as $row) {
                $map[(string) $row['number']] = $row['party'];
            }
            return $map;
        }
    }
    return [];
})();

/* ---------------------------------------------------------------- errors */

/** Thrown by a mutator to refuse a change and explain why to the player. */
final class LobbyError extends RuntimeException
{
    public string $errorCode;
    public int $status;

    public function __construct(string $message, string $errorCode = 'rejected', int $status = 409)
    {
        parent::__construct($message);
        $this->errorCode = $errorCode;
        $this->status = $status;
    }
}

/* ---------------------------------------------------------------- helpers */

function send(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400, string $code = 'error'): void
{
    send(['ok' => false, 'error' => $message, 'code' => $code], $status);
}

function body(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    $raw = file_get_contents('php://input');
    $data = ($raw === false || $raw === '') ? [] : json_decode($raw, true);
    $cached = is_array($data) ? $data : [];
    return $cached;
}

function input(string $key, $default = null)
{
    $b = body();
    if (array_key_exists($key, $b)) {
        return $b[$key];
    }
    if (array_key_exists($key, $_GET)) {
        return $_GET[$key];
    }
    return $default;
}

function clean(string $value, int $maxLength): string
{
    $value = trim(strip_tags($value));
    $value = preg_replace('/\s+/u', ' ', $value) ?? '';
    return mb_substr($value, 0, $maxLength);
}

function route(): string
{
    $action = $_GET['action'] ?? '';
    return strtolower(preg_replace('/[^a-z]/i', '', (string) $action));
}

/**
 * Load the game named by the request and authenticate the caller against it.
 */
function authenticate(FileStore $store): array
{
    $code = Code::normalise((string) input('code', ''));
    $playerId = (string) input('playerId', '');
    $token = (string) input('token', '');

    if (!Code::isWellFormed($code)) {
        fail('That game code does not look right.', 400, 'bad_code');
    }
    $game = $store->findByCode($code);
    if ($game === null) {
        fail('No game with that code. It may have finished.', 404, 'not_found');
    }
    if ($playerId === '' || !isset($game['players'][$playerId])) {
        fail('You are not in this game.', 403, 'not_a_player');
    }
    if (!hash_equals((string) $game['players'][$playerId]['token'], $token)) {
        fail('Could not verify you. Rejoin with the game code.', 403, 'bad_token');
    }
    return [$game, $playerId];
}

/**
 * Apply a change under lock, refresh the heartbeat, and return the lobby view.
 * A mutator that throws LobbyError leaves the game unchanged but still records
 * the heartbeat, and the reason is reported to the caller.
 */
function mutate(FileStore $store, array $game, string $playerId, callable $fn, ?array &$extra = null): void
{
    $error = null;

    $updated = $store->withLock($game['id'], function (array $g) use ($playerId, $fn, &$error) {
        if (!isset($g['players'][$playerId])) {
            return null;
        }
        $g['players'][$playerId]['lastSeen'] = time();

        // Settle anything the clock owes before this request is considered.
        // Doing it here, under the lock, means every route sees a game whose
        // round number is correct — including the route that is about to
        // refuse an action for arriving too late.
        $g = Rounds::advanceIfDue($g, $GLOBALS['campaign'], $GLOBALS['election']);

        // Round fifteen ends the election on its own, so the credit is settled
        // here rather than only where a host closes the polls by hand.
        if (!empty($g['result'])) {
            $g = recordFinishedGame($g, $GLOBALS['profiles']);
        }

        try {
            $result = $fn($g);
        } catch (LobbyError $e) {
            $error = $e;
            $g['updatedAt'] = time();
            return Lobby::ensureHost($g);
        }

        $result['updatedAt'] = time();
        return Lobby::ensureHost($result);
    });

    if ($updated === null) {
        fail('That game is no longer available.', 404, 'not_found');
    }

    if ($error !== null) {
        send([
            'ok' => false,
            'error' => $error->getMessage(),
            'code' => $error->errorCode,
            'game' => Lobby::publicView($updated, $playerId),
        ], $error->status);
    }

    send(array_merge(
        ['ok' => true, 'game' => Lobby::publicView($updated, $playerId)],
        $extra ?? []
    ));
}

/**
 * Link a seat to the profile the browser is carrying, if it has one. The
 * profile id is generated and kept by the client — a low bar deliberately,
 * because this is a game — and it is what lets a finished election be
 * credited to somebody afterwards.
 */
function attachProfile(array $player, Profiles $profiles): array
{
    $id = Profiles::cleanId((string) input('profileId', ''));
    if ($id === '') {
        return $player;
    }
    $name = Profiles::cleanName((string) input('profileName', ''));
    $profile = $profiles->ensure($id, $name, (string) $player['portraitSeed']);
    if (!$profile) {
        return $player;
    }
    $player['profileId'] = $id;
    if ($profile['name'] !== '') {
        $player['profileName'] = $profile['name'];
    }
    return $player;
}

/**
 * Credit a finished election to everyone who played it. Called once, when the
 * result is first decided, and guarded so a replayed poll cannot count the
 * same election twice.
 */
function recordFinishedGame(array $game, Profiles $profiles): array
{
    if (!empty($game['recorded']) || empty($game['result'])) {
        return $game;
    }
    $game['recorded'] = true;

    $result = $game['result'];
    $coalition = $game['coalition'] ?? [];
    $inGovernment = [];
    if (($coalition['status'] ?? '') === 'formed') {
        $inGovernment = $coalition['members'] ?? [];
    }

    foreach ($result['standings'] as $row) {
        $pid = $row['playerId'] ?? null;
        if ($pid === null || empty($game['players'][$pid])) {
            continue;
        }
        $player = $game['players'][$pid];
        if (empty($player['profileId']) || !empty($player['isAI'])) {
            continue;
        }

        $viaCoalition = in_array($pid, $inGovernment, true);
        $won = ($result['winner'] && ($result['winner']['playerId'] ?? null) === $pid) || $viaCoalition;

        $profiles->record($player['profileId'], [
            'party' => $row['party'],
            'seats' => (int) $row['seats'],
            'won' => $won,
            'coalition' => $viaCoalition,
            'outcome' => $result['outcome'],
            'spent' => (int) ($player['spent'] ?? 0),
            'behindAtTen' => wasBehindAtTen($game, (string) $row['party']),
            'usedHighRisk' => usedHighRisk($player),
        ], true);
    }

    // One election, counted once — whatever the number of people who played
    // it. A government forms either by winning outright or by a coalition
    // that actually came together.
    $profiles->countElection(
        !empty($result['winner']) || $inGovernment !== [],
        $inGovernment !== []
    );

    return $game;
}

/** Were they behind at round ten? Read from the round history. */
function wasBehindAtTen(array $game, string $party): bool
{
    foreach (($game['history'] ?? []) as $snap) {
        if ((int) $snap['round'] !== 10) {
            continue;
        }
        $mine = (int) ($snap['seats'][$party] ?? 0);
        foreach ($snap['seats'] as $other => $seats) {
            if ($other !== $party && (int) $seats > $mine) {
                return true;
            }
        }
        return false;
    }
    return false;
}

/** Did they reach for the risky mechanics at any point? */
function usedHighRisk(array $player): bool
{
    foreach (($player['actions'] ?? []) as $a) {
        if (($a['group'] ?? '') === 'risky') {
            return true;
        }
    }
    return false;
}

/* ---------------------------------------------------------------- routing */

// Opportunistic cleanup: cheap, and keeps the directory from growing forever.
try {
    if (random_int(1, 25) === 1) {
        $store->pruneOlderThan(GAME_TTL_SECONDS);
    }
} catch (Throwable $e) {
    // Never let housekeeping break a request.
}

switch (route()) {
    /* ------------------------------------------------------------ create */
    case 'create': {
        if ($store->activeGameCount() >= MAX_ACTIVE_GAMES) {
            $store->pruneOlderThan(3600);
            if ($store->activeGameCount() >= MAX_ACTIVE_GAMES) {
                fail('Too many games are running right now. Try again shortly.', 503, 'busy');
            }
        }

        $game = Lobby::newGame(Code::generateUnique($store));
        $player = Lobby::newPlayer(1, $campaign->startingBudget());
        $player = attachProfile($player, $profiles);
        $game['players'][$player['id']] = $player;
        $game['hostId'] = $player['id'];
        $store->save($game);

        send([
            'ok' => true,
            'code' => $game['code'],
            'playerId' => $player['id'],
            'token' => $player['token'],
            'game' => Lobby::publicView($game, $player['id']),
        ]);
    }

    /* -------------------------------------------------------------- join */
    case 'join': {
        $code = Code::normalise((string) input('code', ''));
        if (!Code::isWellFormed($code)) {
            fail('That game code does not look right.', 400, 'bad_code');
        }
        $existing = $store->findByCode($code);
        if ($existing === null) {
            fail('No game with that code. Check it and try again.', 404, 'not_found');
        }

        $joined = null;
        $reason = null;

        $updated = $store->withLock($existing['id'], function (array $g) use (&$joined, &$reason) {
            if ($g['phase'] !== 'lobby') {
                $reason = 'That game has already started.';
                return $g;
            }
            $slot = Lobby::nextFreeSlot($g);
            if ($slot === null) {
                $reason = 'That game is full — it takes ' . Lobby::MAX_PLAYERS . ' players.';
                return $g;
            }
            $player = Lobby::newPlayer($slot, $GLOBALS['campaign']->startingBudget());
            $player = attachProfile($player, $GLOBALS['profiles']);
            $g['players'][$player['id']] = $player;
            if ($g['hostId'] === null) {
                $g['hostId'] = $player['id'];
            }
            $g['updatedAt'] = time();
            $joined = $player;
            return $g;
        });

        if ($updated === null) {
            fail('That game is no longer available.', 404, 'not_found');
        }
        if ($joined === null) {
            fail($reason ?? 'Could not join that game.', 409, 'cannot_join');
        }

        $store->save($updated);
        send([
            'ok' => true,
            'code' => $updated['code'],
            'playerId' => $joined['id'],
            'token' => $joined['token'],
            'game' => Lobby::publicView($updated, $joined['id']),
        ]);
    }

    /* ------------------------------------------------------------- state */
    case 'state': {
        [$game, $playerId] = authenticate($store);
        mutate($store, $game, $playerId, static fn(array $g) => $g); // heartbeat only
    }

    /* ------------------------------------------------------------- party */
    case 'party': {
        [$game, $playerId] = authenticate($store);
        $partyId = strtolower((string) input('partyId', ''));
        if ($partyId !== '' && !in_array($partyId, Lobby::PARTIES, true)) {
            fail('Unknown party.', 400, 'bad_party');
        }

        mutate($store, $game, $playerId, static function (array $g) use ($partyId, $playerId) {
            if ($g['phase'] !== 'lobby') {
                throw new LobbyError('The election has already started.');
            }
            if ($partyId !== '' && !Lobby::partyIsFree($g, $partyId, $playerId)) {
                throw new LobbyError('Another player has already taken that party.', 'party_taken');
            }
            $g['players'][$playerId]['partyId'] = $partyId === '' ? null : $partyId;
            // Changing party un-readies you, so nobody starts on a stale choice.
            $g['players'][$playerId]['ready'] = false;
            return $g;
        });
    }

    /* ----------------------------------------------------------- details */
    case 'details': {
        [$game, $playerId] = authenticate($store);
        $name = clean((string) input('candidateName', ''), 60);
        $slogan = clean((string) input('slogan', ''), 80);
        // Budget is granted, not submitted — a client cannot set its own purse.

        // A player's profile is usually started here rather than at create or
        // join, because this is the first moment they have typed a name to
        // put on it. Attaching it again is harmless and it is what makes a
        // finished election creditable.
        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $name, $slogan, $profiles) {
            if ($g['phase'] !== 'lobby') {
                throw new LobbyError('The election has already started.');
            }
            $g['players'][$playerId]['candidateName'] = $name;
            $g['players'][$playerId]['slogan'] = $slogan;
            $g['players'][$playerId] = attachProfile($g['players'][$playerId], $profiles);
            return $g;
        });
    }

    /* ------------------------------------------------------------- ready */
    case 'ready': {
        [$game, $playerId] = authenticate($store);
        $ready = filter_var(input('ready', true), FILTER_VALIDATE_BOOLEAN);

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $ready) {
            if ($g['phase'] !== 'lobby') {
                throw new LobbyError('The election has already started.');
            }
            if ($ready && !Lobby::playerIsComplete($g['players'][$playerId])) {
                throw new LobbyError(
                    'Pick a party and fill in your candidate, slogan and budget first.',
                    'incomplete'
                );
            }
            $g['players'][$playerId]['ready'] = $ready;
            return $g;
        });
    }

    /* -------------------------------------------------------- end round */
    case 'endround': {
        [$game, $playerId] = authenticate($store);

        // Declaring yourself finished locks only you. Everybody else plays on
        // until they say the same or the clock runs out. The round then closes
        // inside mutate(), which already runs the pipeline under the lock.
        mutate($store, $game, $playerId, static function (array $g) use ($playerId) {
            if (($g['phase'] ?? '') !== 'election') {
                throw new LobbyError('The election is not running.');
            }
            if (($g['stage'] ?? '') !== 'playing') {
                throw new LobbyError('That round has already closed.');
            }
            if (!empty($g['players'][$playerId]['eliminated'])) {
                throw new LobbyError('You are out of this election.');
            }
            $g['players'][$playerId]['roundReady'] = true;
            $g['players'][$playerId]['readyRound'] = (int) ($g['round'] ?? 1);
            return $g;
        });
    }

    /* ------------------------------------------------- priority districts */
    case 'priority': {
        [$game, $playerId] = authenticate($store);

        $wanted = input('districts', []);
        if (!is_array($wanted)) {
            $wanted = [];
        }

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $wanted) {
            $cfg = $GLOBALS['campaign']->config()['territory']['priorityDistricts'] ?? [];
            $max = (int) ($cfg['max'] ?? 23);

            // Only real district ids, no duplicates, and never more than the
            // configured ceiling — a client picking all twenty-three and then
            // some is a client to be trimmed, not trusted.
            $known = [];
            foreach ($GLOBALS['territory']->districts() as $d) {
                $known[(string) $d['id']] = true;
            }
            $clean = [];
            foreach ($wanted as $id) {
                $id = (string) $id;
                if (isset($known[$id]) && !in_array($id, $clean, true)) {
                    $clean[] = $id;
                }
            }
            $g['players'][$playerId]['priorityDistricts'] = array_slice($clean, 0, $max);
            return $g;
        });
    }

    /* --------------------------------------------------------- alliances */
    case 'ally': {
        [$game, $playerId] = authenticate($store);
        $move = strtolower((string) input('move', 'offer'));   // offer|accept|decline|withdraw
        $otherId = (string) input('playerId2', '');

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $otherId, $move) {
            $config = $GLOBALS['campaign']->config();

            if ($move === 'accept') {
                $offers = $g['allianceOffers'] ?? [];
                if (!isset($offers[$otherId . '>' . $playerId])) {
                    throw new LobbyError('There is no offer from that player.');
                }
                $reason = Alliances::offerBlockedReason($g, $otherId, $playerId, $config);
                if ($reason !== null) {
                    throw new LobbyError($reason, 'alliance_blocked');
                }
                return Alliances::accept($g, $playerId, $otherId);
            }

            if ($move === 'decline') {
                return Alliances::drop($g, $otherId, $playerId);
            }
            if ($move === 'withdraw') {
                return Alliances::drop($g, $playerId, $otherId);
            }

            $reason = Alliances::offerBlockedReason($g, $playerId, $otherId, $config);
            if ($reason !== null) {
                throw new LobbyError($reason, 'alliance_blocked');
            }
            return Alliances::offer($g, $playerId, $otherId);
        });
    }

    /* ------------------------------------------------------------- start */
    case 'start': {
        [$game, $playerId] = authenticate($store);

        mutate($store, $game, $playerId, static function (array $g) use ($playerId) {
            if ($g['hostId'] !== $playerId) {
                throw new LobbyError('Only the host can start the election.', 'not_host', 403);
            }
            $reason = Lobby::startBlockedReason($g);
            if ($reason !== null) {
                throw new LobbyError($reason, 'not_ready');
            }

            // The round length the host chose, checked against the offered
            // options rather than trusted — a client that asks for a
            // five-second round should not get one.
            $engineCfg = $GLOBALS['campaign']->rounds();
            $options = array_map('intval', $engineCfg['durationOptions'] ?? []);
            $wanted = (int) input('roundSeconds', 0);
            $g['roundSeconds'] = in_array($wanted, $options, true)
                ? $wanted
                : (int) $engineCfg['seconds'];

            $g['phase'] = 'election';

            // Deal the opening map once. Everyone campaigns on this same
            // board, so a rally in Moga shows up on all four screens rather
            // than only in the results.
            $engine = $GLOBALS['campaign'];
            [$board, $incumbency] = $engine->seedSupport(
                $GLOBALS['constituencyNumbers'],
                Lobby::GAME_PARTIES,
                $g['id'],
                $GLOBALS['incumbentParties']
            );
            $g['board'] = $board;
            $g['incumbency'] = $incumbency;

            // What the deal handed each party. Recorded once, so a grant can
            // only ever be paid for a district somebody actually took.
            $terr = $GLOBALS['territory'];
            $openingLeaders = Territory::leadersOf($board);
            foreach ($g['players'] as $pid => $pl) {
                $party = (string) ($pl['partyId'] ?? '');
                $g['players'][$pid]['openingDistricts'] = $party === ''
                    ? []
                    : array_map(
                        static fn($d) => (string) $d['id'],
                        $terr->heldBy($openingLeaders, $party)
                    );
            }
            $g['history'] = [];
            $g['roundLog'] = [];

            // Any party nobody claimed gets an opponent, so the scoreboard
            // always has four competitors and a game with two people at the
            // table is still an election rather than a two-horse race.
            if (!empty($engine->config()['ai']['enabled'])) {
                $slot = Lobby::MAX_PLAYERS;
                foreach (Lobby::unclaimedParties($g) as $partyId) {
                    $opponent = AI::newPlayer($slot--, $partyId, $g['id'], $engine);
                    $g['players'][$opponent['id']] = $opponent;
                }
            }

            foreach ($g['players'] as $pid => $p) {
                $partyId = (string) ($p['partyId'] ?? '');
                $g['players'][$pid]['seatsLed'] = $partyId === ''
                    ? 0
                    : $engine->seatsLed($board, $partyId);
                $g['players'][$pid]['summary'] = null;
            }

            // The opening leader map. Round one then has something to compare
            // against, so its results screen reports real changes rather than
            // announcing all 117 seats at once.
            $g['leaders'] = Rounds::currentLeaders($board);
            $g['leadParty'] = null;
            $g['lastResult'] = null;
            $GLOBALS['profiles']->countGameStarted();

            return Rounds::begin($g, 1, $engine);
        });
    }

    /* ---------------------------------------------------------- campaign */
    case 'campaign': {
        [$game, $playerId] = authenticate($store);
        $actionId = preg_replace('/[^a-z]/i', '', (string) input('actionId', ''));
        $target = input('constituency', null);
        $target = ($target === null || $target === '') ? null : (int) $target;
        // How much the player chose to put behind it. The server clamps it to
        // what the action allows, so a client cannot spend outside the range.
        $amount = input('amount', null);
        $amount = ($amount === null || $amount === '') ? null : (int) $amount;

        if ($campaign->action($actionId) === null) {
            fail('Unknown action.', 400, 'bad_action');
        }

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $actionId, $target, $amount) {
            if ($g['phase'] !== 'election') {
                throw new LobbyError('The election has not started yet.', 'not_started');
            }
            $engine = $GLOBALS['campaign'];
            $player = $g['players'][$playerId];

            if (!Rounds::isLive($g, $engine)) {
                $waiting = ($g['stage'] ?? '') === 'results';
                throw new LobbyError(
                    $waiting
                        ? 'The round is being counted. The next one opens shortly.'
                        : 'That round has closed. Wait for the next one.',
                    'round_over'
                );
            }
            if (!empty($player['record']['disqualified'])) {
                throw new LobbyError('You have been disqualified from this election.', 'disqualified');
            }

            $action = $engine->action($actionId);
            if (($action['group'] ?? '') === 'risky'
                && Investigation::isRestricted($player, (int) ($g['turn'] ?? 1))) {
                throw new LobbyError(
                    'You are under a campaign restriction and cannot use risky strategies yet.',
                    'restricted'
                );
            }

            $board = Rounds::boardOf($g);
            $blocked = $engine->blockedReason($player, $board, $actionId, $target, $amount);
            if ($blocked !== null) {
                throw new LobbyError($blocked, 'blocked');
            }

            // The server rolls, so no client can pick its own outcome.
            $rolls = Campaign::rollsFor($g['id'] . ':' . $playerId, (int) ($player['rollCount'] ?? 0));
            $player['rollCount'] = (int) ($player['rollCount'] ?? 0) + 1;
            $player['round'] = (int) $g['round'];

            [$player, $board, $report] = $engine->play($player, $board, $actionId, $target, $rolls, $amount);

            $g['board'] = $board;
            $counts = $engine->seatCounts($board);
            foreach ($g['players'] as $otherId => $other) {
                $pid = (string) ($other['partyId'] ?? '');
                $g['players'][$otherId]['seatsLed'] = $pid === '' ? 0 : (int) ($counts[$pid] ?? 0);
            }
            $player['seatsLed'] = (int) ($counts[(string) $player['partyId']] ?? 0);

            $g['players'][$playerId] = $player;
            $g['lastReport'] = $report;
            return $g;
        });
    }

    /* -------------------------------------------------------------- loan */
    case 'loan': {
        [$game, $playerId] = authenticate($store);
        $amount = (int) input('amount', 0);
        $quoteOnly = filter_var(input('quote', false), FILTER_VALIDATE_BOOLEAN);

        // A quote changes nothing. The confirmation screen asks for one first
        // so it can never show terms the server would go on to refuse.
        if ($quoteOnly) {
            $game = Rounds::advanceIfDue($game, $campaign, $election);
            send([
                'ok' => true,
                'offer' => $campaign->loanOffer(
                    $game['players'][$playerId],
                    $amount,
                    (int) ($game['round'] ?? 1)
                ),
                'game' => Lobby::publicView($game, $playerId),
            ]);
        }

        $extra = [];
        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $amount, &$extra) {
            if (($g['phase'] ?? '') !== 'election') {
                throw new LobbyError('You can only borrow during the campaign.', 'not_campaign');
            }
            if (($g['stage'] ?? '') === 'results') {
                throw new LobbyError('The round is being counted. Try again when it opens.', 'round_over');
            }
            $engine = $GLOBALS['campaign'];
            [$player, $offer] = $engine->takeLoan(
                $g['players'][$playerId],
                $amount,
                (int) ($g['round'] ?? 1)
            );
            if (!$offer['ok']) {
                throw new LobbyError($offer['error'], 'loan_refused');
            }
            $g['players'][$playerId] = $player;
            $extra = ['offer' => $offer];
            return $g;
        }, $extra);
    }

    /* ----------------------------------------------------------- history */
    case 'history': {
        [$game, $playerId] = authenticate($store);
        $number = (int) input('constituency', 0);
        if ($number <= 0) {
            fail('Which constituency?', 400, 'bad_constituency');
        }
        // Fifteen full boards is far more than a poll should carry, so a
        // seat's history is fetched only when somebody opens that seat.
        send([
            'ok' => true,
            'constituency' => $number,
            'history' => Rounds::seatHistory($game, (string) $number),
        ]);
    }

    /* ------------------------------------------------------------ report */
    case 'report': {
        [$game, $playerId] = authenticate($store);
        $accusedId = (string) input('accusedId', '');
        $reason = preg_replace('/[^a-z]/i', '', (string) input('reason', ''));

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $accusedId, $reason) {
            if (($g['phase'] ?? '') !== 'election') {
                throw new LobbyError('Reports can only be made during the campaign.', 'not_campaign');
            }
            if (!empty($g['players'][$playerId]['record']['disqualified'])) {
                throw new LobbyError('You are out of this election.', 'disqualified');
            }
            [$g, $res] = $GLOBALS['investigation']->report($g, $playerId, $accusedId, $reason);
            if (!$res['ok']) {
                throw new LobbyError($res['error'], 'report_refused');
            }
            $g['lastReport'] = [
                'accusedId' => $accusedId,
                'reports' => $res['reports'],
                'opened' => $res['opened'],
                'at' => time(),
            ];
            return $g;
        });
    }

    /* ---------------------------------------------------------- election */
    case 'declare': {
        [$game, $playerId] = authenticate($store);

        mutate($store, $game, $playerId, static function (array $g) use ($playerId) {
            if ($g['hostId'] !== $playerId) {
                throw new LobbyError('Only the host can close the polls.', 'not_host', 403);
            }
            if (($g['phase'] ?? '') !== 'election') {
                throw new LobbyError('The campaign is not running.', 'not_campaign');
            }
            $result = $GLOBALS['election']->run($g);
            $g['result'] = $result;
            $g['phase'] = $result['outcome'] === 'majority' ? 'government' : 'hung';
            $g['stage'] = 'final';
            $g['possibleCoalitions'] = $GLOBALS['election']->possibleCoalitions($result);
            return recordFinishedGame($g, $GLOBALS['profiles']);
        });
    }

    /* --------------------------------------------------------- coalition */
    case 'coalition': {
        [$game, $playerId] = authenticate($store);
        $move = preg_replace('/[^a-z]/i', '', (string) input('move', ''));
        $terms = [
            'partnerId' => (string) input('partnerId', ''),
            'chiefMinisterId' => (string) input('chiefMinisterId', ''),
            'cabinet' => preg_replace('/[^a-zA-Z]/', '', (string) input('cabinet', '')),
            'policy' => preg_replace('/[^a-zA-Z]/', '', (string) input('policy', '')),
            'resources' => preg_replace('/[^a-zA-Z]/', '', (string) input('resources', '')),
        ];
        $note = clean((string) input('note', ''), 120);

        mutate($store, $game, $playerId, static function (array $g) use ($playerId, $move, $terms, $note) {
            $rules = $GLOBALS['coalitionRules'];
            if ($move === 'propose') {
                [$g, $res] = $rules->propose($g, $playerId, $terms);
            } elseif ($move === 'accept') {
                [$g, $res] = $rules->accept($g, $playerId);
            } elseif ($move === 'reject') {
                [$g, $res] = $rules->reject($g, $playerId, $note);
            } else {
                throw new LobbyError('Unknown coalition move.', 'bad_move', 400);
            }
            if (!$res['ok']) {
                throw new LobbyError($res['error'], 'coalition_refused');
            }
            // A coalition changes who took office, so the credit is settled
            // once it is formed rather than when the seats were counted.
            if (($g['coalition']['status'] ?? '') === 'formed') {
                $g['recorded'] = false;
                $g = recordFinishedGame($g, $GLOBALS['profiles']);
            }
            return $g;
        });
    }

    /* ------------------------------------------------------------- leave */
    case 'leave': {
        /*
         * Leaving is not ending.
         *
         * Closing a tab, losing signal, or walking away mid-round must never
         * cost somebody their election — they keep their seat, their money and
         * their position, and can come back to exactly where they were. That
         * is what `leave` does once an election is under way.
         *
         * `end=1` is the other thing entirely: a deliberate, confirmed
         * decision to be finished with this game. It is the only path that
         * takes away the right to rejoin, and it is irreversible.
         *
         * In the lobby, before anybody has played, leaving really is leaving —
         * there is no game state worth preserving and an empty seat should go
         * back to the pool.
         */
        [$game, $playerId] = authenticate($store);
        $ending = filter_var(input('end', false), FILTER_VALIDATE_BOOLEAN);
        $inLobby = ($game['phase'] ?? '') === 'lobby';

        $updated = $store->withLock(
            $game['id'],
            static function (array $g) use ($playerId, $ending, $inLobby) {
                if ($inLobby) {
                    unset($g['players'][$playerId]);
                } elseif ($ending) {
                    // Out for good. The seats they built stay on the board —
                    // the support is real and the other campaigns have to beat
                    // it — but the player takes no further part and cannot
                    // come back.
                    $g['players'][$playerId]['endedByPlayer'] = true;
                    $g['players'][$playerId]['leftAt'] = time();
                    $g['players'][$playerId]['roundReady'] = true;
                } else {
                    // Stepped away. Nothing is taken from them.
                    $g['players'][$playerId]['awayAt'] = time();
                }
                $g['updatedAt'] = time();
                return Lobby::ensureHost($g);
            }
        );

        if ($updated !== null && count($updated['players']) === 0) {
            $store->delete($updated['id']);
        }
        send(['ok' => true, 'ended' => $ending]);
    }

    /* ------------------------------------------------------------ resume */
    case 'resume': {
        /*
         * Is there a game to go back to?
         *
         * Answers from the profile id the browser carries, so a player who
         * cleared their session — or opened the game on another device signed
         * in as themselves — still finds their election. Never lists a game
         * they explicitly ended, and never one that has already finished.
         */
        $profileId = Profiles::cleanId((string) input('profileId', ''));
        if ($profileId === '') {
            send(['ok' => true, 'games' => []]);
        }

        $open = [];
        foreach ($store->gamesForProfile($profileId) as $row) {
            $g = $row['game'];
            $p = $g['players'][$row['playerId']];
            $open[] = [
                'code' => (string) $g['code'],
                'phase' => (string) $g['phase'],
                'round' => (int) ($g['round'] ?? 0),
                'roundsTotal' => (int) ($g['roundsTotal'] ?? 0),
                'players' => count($g['players'] ?? []),
                'partyId' => $p['partyId'] ?? null,

                // The credentials to walk back in with. They are this
                // player's own, returned only to a request carrying their own
                // profile id, which is the same thing that identifies them
                // everywhere else in this game.
                'playerId' => $row['playerId'],
                'token' => (string) ($p['token'] ?? ''),
                'updatedAt' => (int) ($g['updatedAt'] ?? 0),
            ];
        }

        send(['ok' => true, 'games' => array_slice($open, 0, 3)]);
    }

    /* ------------------------------------------------------------- stats */
    case 'stats': {
        // Everything the home screen shows, counted from games that actually
        // finished. A new installation answers zero, and says so.
        send([
            'ok' => true,
            'summary' => $profiles->summary(),
            'leaderboard' => $profiles->leaderboard(10),
        ]);
    }

    /* ----------------------------------------------------------- profile */
    case 'profile': {
        $id = Profiles::cleanId((string) input('profileId', ''));
        if ($id === '') {
            fail('No profile id.', 400, 'bad_profile');
        }
        $profile = $profiles->ensure(
            $id,
            (string) input('name', ''),
            (string) input('portraitSeed', '')
        );
        if (!$profile) {
            fail('That profile could not be read.', 400, 'bad_profile');
        }
        send([
            'ok' => true,
            'profile' => $profiles->publicView($profile, $campaign->config()),
        ]);
    }

    /* ------------------------------------------------------------ record */
    case 'record': {
        // A solo game runs in the browser, so this is the player's own account
        // of it. It is kept on their profile, where it is their business, and
        // deliberately never reaches the leaderboard — see lib/Profiles.php.
        $id = Profiles::cleanId((string) input('profileId', ''));
        if ($id === '') {
            fail('No profile id.', 400, 'bad_profile');
        }
        $profiles->ensure($id, (string) input('name', ''), (string) input('portraitSeed', ''));

        $party = preg_replace('/[^a-z]/', '', strtolower((string) input('party', '')));
        if (!in_array($party, Lobby::PARTIES, true)) {
            fail('Unknown party.', 400, 'bad_party');
        }

        $profile = $profiles->record($id, [
            'party' => $party,
            'seats' => max(0, min(117, (int) input('seats', 0))),
            'won' => filter_var(input('won', false), FILTER_VALIDATE_BOOLEAN),
            'coalition' => filter_var(input('coalition', false), FILTER_VALIDATE_BOOLEAN),
            'outcome' => preg_replace('/[^a-z]/', '', strtolower((string) input('outcome', ''))),
            'spent' => max(0, (int) input('spent', 0)),
            'behindAtTen' => filter_var(input('behindAtTen', false), FILTER_VALIDATE_BOOLEAN),
            'usedHighRisk' => filter_var(input('usedHighRisk', false), FILTER_VALIDATE_BOOLEAN),
        ], false);

        send([
            'ok' => true,
            'profile' => $profile ? $profiles->publicView($profile, $campaign->config()) : null,
        ]);
    }

    /* ------------------------------------------------------------ health */
    case 'health': {
        send([
            'ok' => true,
            'php' => PHP_VERSION,
            'games' => $store->activeGameCount(),
            'writable' => is_writable($dataDir),
        ]);
    }

    default:
        fail('Unknown endpoint.', 404, 'no_route');
}
