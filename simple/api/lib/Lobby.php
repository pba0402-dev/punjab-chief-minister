<?php
/**
 * Lobby rules.
 * ------------------------------------------------------------------
 * Everything that decides what a game looks like and what a player may do.
 * Pure functions over the game array — no HTTP, no storage — so the rules
 * can be reasoned about and tested on their own.
 */
declare(strict_types=1);

final class Lobby
{
    public const MAX_PLAYERS = 4;
    public const MIN_PLAYERS = 2;

    /** A player is "connected" if we have heard from them recently. */
    public const CONNECT_TIMEOUT = 20;

    /** Party ids a player may pick. Mirrors js/data/parties.js. */
    public const PARTIES = ['aap', 'inc', 'bjp', 'sad'];

    /** Every party the board tracks, including the unplayable Others bucket. */
    public const GAME_PARTIES = ['aap', 'inc', 'bjp', 'sad', 'oth'];

    public static function newGame(string $code): array
    {
        $now = time();
        return [
            'id' => bin2hex(random_bytes(16)),
            'code' => $code,
            'phase' => 'lobby', // lobby | election | counting | hung | government
            'maxPlayers' => self::MAX_PLAYERS,
            'minPlayers' => self::MIN_PLAYERS,
            'hostId' => null,
            'turn' => 0,

            // The round clock. roundStartedAt is a server timestamp and every
            // response carries the server's own time, so a client works out
            // the seconds left from those two rather than trusting its own
            // clock. A refresh mid-round therefore lands on the right second.
            'round' => 0,
            'roundStartedAt' => 0,
            'roundEndsAt' => 0,

            // Chosen by the host before the election starts, from the offered
            // options. Zero here means "not chosen yet"; begin() falls back to
            // the configured default.
            'roundSeconds' => 0,
            'roundState' => 'not_started',

            // Agreements between players, and who has been put out of the
            // election at the checkpoint round.
            'alliances' => [],
            'allianceOffers' => [],
            'eliminations' => [],

            // One board, shared. Every player campaigns on the same map and
            // sees the same leaders, which is the whole point of playing in
            // the same room. What stays private is money, heat and what each
            // player actually did.
            'board' => (object) [],
            'history' => [],
            'roundLog' => [],

            // Who led each seat when the last round was settled, so the next
            // one can report what changed hands rather than listing all 117.
            'leaders' => (object) [],
            'leadParty' => null,
            'lastResult' => null,
            'stage' => 'lobby', // lobby | playing | results | final
            'players' => [],
            'incumbency' => (object) [],
            'result' => null,
            'coalition' => Coalition::newState(),
            'possibleCoalitions' => [],
            'createdAt' => $now,
            'updatedAt' => $now,
        ];
    }

    public static function newPlayer(int $slot, int $startingBudget): array
    {
        $now = time();
        return [
            'id' => bin2hex(random_bytes(8)),
            'token' => bin2hex(random_bytes(16)),
            'slot' => $slot,
            'partyId' => null,
            'candidateName' => '',
            'slogan' => '',

            // Every player is granted the same purse. It is never entered by
            // hand, and it is theirs alone — nothing is pooled.
            //
            // Cash and debt are deliberately separate numbers. Cash is what
            // can be spent and may never go below zero; borrowed money lands
            // in cash but leaves a repayment standing against the player, so
            // a rich-looking campaign can still be a campaign in trouble.
            'budget' => $startingBudget,
            'cash' => $startingBudget,
            'spent' => 0,
            'borrowed' => 0,
            'repaid' => 0,
            'interestPaid' => 0,
            'granted' => 0,
            'raised' => 0,
            'finesPaid' => 0,
            'loans' => [],
            'defaults' => 0,

            // Region-locked grant purses, and the account of every movement
            // of money behind the running totals above.
            'grants' => [],
            'ledger' => [],
            'incomeCredited' => [],
            'grantsCredited' => [],
            'incomeTotal' => 0,
            'grantTotalEarned' => 0,
            'districtsHeld' => 0,

            // Districts this player has named as priority targets. A
            // statement of intent, not a claim of ownership.
            'priorityDistricts' => [],

            // Where the round stands, and where the election stands.
            'roundReady' => false,
            'readyRound' => 0,
            'roundSpent' => 0,
            'eliminated' => false,
            'eliminatedRound' => 0,
            'allyId' => null,

            'heat' => 0,
            'actions' => [],
            'roundActions' => 0,
            'rollCount' => 0,
            'seatsLed' => 0,
            'summary' => null,

            // A fictional candidate portrait, drawn from this seed. It is
            // fixed the moment a player sits down and never changes, so the
            // face on the scoreboard is the same face all game — including
            // after a disconnection and a rejoin.
            'portraitSeed' => bin2hex(random_bytes(6)),
            'isAI' => false,

            // Linked to a lasting profile when the browser carries one, so a
            // finished election can be credited afterwards.
            'profileId' => null,
            'profileName' => null,

            'ready' => false,
            'joinedAt' => $now,
            'lastSeen' => $now,

            // Reports, penalties and restrictions all live together.
            'record' => Investigation::newRecord(),
        ];
    }

    /** The lowest free slot number, or null if the game is full. */
    public static function nextFreeSlot(array $game): ?int
    {
        $taken = [];
        foreach ($game['players'] as $p) {
            $taken[(int) $p['slot']] = true;
        }
        for ($slot = 1; $slot <= self::MAX_PLAYERS; $slot++) {
            if (!isset($taken[$slot])) {
                return $slot;
            }
        }
        return null;
    }

    public static function isConnected(array $player, ?int $now = null): bool
    {
        // An opponent is never away from its desk.
        if (!empty($player['isAI'])) {
            return true;
        }
        $now = $now ?? time();
        return ($now - (int) $player['lastSeen']) <= self::CONNECT_TIMEOUT;
    }

    /**
     * Connected humans. Opponents are excluded on purpose: this list decides
     * who can host and whether the game can start, and neither is a question
     * an opponent gets a say in.
     */
    public static function connectedPlayers(array $game): array
    {
        $now = time();
        return array_values(array_filter($game['players'], static function ($p) use ($now) {
            return empty($p['isAI']) && self::isConnected($p, $now);
        }));
    }

    /** Parties with nobody sitting behind them. */
    public static function unclaimedParties(array $game): array
    {
        $taken = self::takenParties($game);
        return array_values(array_filter(
            self::PARTIES,
            static fn($id) => !in_array($id, $taken, true)
        ));
    }

    /**
     * If the host has dropped, hand the role to the longest-present connected
     * player. Returns the game, changed or not.
     */
    public static function ensureHost(array $game): array
    {
        $host = $game['hostId'] !== null && isset($game['players'][$game['hostId']])
            ? $game['players'][$game['hostId']]
            : null;

        if ($host !== null && self::isConnected($host)) {
            return $game;
        }

        $candidates = self::connectedPlayers($game);
        if (count($candidates) === 0) {
            return $game; // nobody home; leave the host as-is for reconnection
        }

        usort($candidates, static function ($a, $b) {
            return $a['joinedAt'] <=> $b['joinedAt'] ?: $a['slot'] <=> $b['slot'];
        });
        $game['hostId'] = $candidates[0]['id'];
        return $game;
    }

    /** Party ids already claimed, excluding one player if given. */
    public static function takenParties(array $game, ?string $exceptPlayerId = null): array
    {
        $taken = [];
        foreach ($game['players'] as $id => $p) {
            if ($exceptPlayerId !== null && $id === $exceptPlayerId) {
                continue;
            }
            if (!empty($p['partyId'])) {
                $taken[] = $p['partyId'];
            }
        }
        return $taken;
    }

    public static function partyIsFree(array $game, string $partyId, string $playerId): bool
    {
        return !in_array($partyId, self::takenParties($game, $playerId), true);
    }

    /** A player is startable when they have a party and a candidate name. */
    public static function playerIsComplete(array $p): bool
    {
        return !empty($p['partyId'])
            && trim((string) $p['candidateName']) !== ''
            && true;   // no slogan: see the note in js/ui/setup.js
    }

    /**
     * Why the host cannot start yet, or null when they can.
     * Only connected players are counted — a player who closed their laptop
     * should not be able to hold the game hostage.
     */
    public static function startBlockedReason(array $game): ?string
    {
        if ($game['phase'] !== 'lobby') {
            return 'The election has already started.';
        }

        $connected = self::connectedPlayers($game);
        $count = count($connected);

        if ($count < self::MIN_PLAYERS) {
            return 'Waiting for at least ' . self::MIN_PLAYERS . ' players.';
        }

        foreach ($connected as $p) {
            if (!self::playerIsComplete($p)) {
                return 'Every player needs a party and a candidate name.';
            }
            if (empty($p['ready'])) {
                return 'Waiting for all players to be ready.';
            }
        }
        return null;
    }

    /** Everything a player still owes, principal and interest together. */
    public static function debtOf(array $player): int
    {
        $owed = 0;
        foreach (($player['loans'] ?? []) as $loan) {
            if (empty($loan['settled'])) {
                $owed += (int) $loan['repay'];
            }
        }
        return $owed;
    }

    /**
     * Seats currently led, per party. Everyone sees the same figures because
     * everyone is looking at the same board.
     */
    public static function seatCounts(array $board): array
    {
        $counts = [];
        foreach (self::GAME_PARTIES as $id) {
            $counts[$id] = 0;
        }
        foreach ($board as $seat) {
            $best = null;
            $bestId = null;
            foreach ($seat as $pid => $v) {
                if ($best === null || $v > $best) {
                    $best = $v;
                    $bestId = $pid;
                }
            }
            if ($bestId !== null) {
                $counts[$bestId] = ($counts[$bestId] ?? 0) + 1;
            }
        }
        return $counts;
    }

    /**
     * The view sent to clients. Strips secrets, adds derived fields, and pads
     * the roster out to four slots so the lobby can show empty seats.
     */
    public static function publicView(array $game, ?string $viewerId = null): array
    {
        $now = time();
        $bySlot = [];
        foreach ($game['players'] as $p) {
            $bySlot[(int) $p['slot']] = $p;
        }

        $slots = [];
        for ($slot = 1; $slot <= self::MAX_PLAYERS; $slot++) {
            if (!isset($bySlot[$slot])) {
                $slots[] = ['slot' => $slot, 'empty' => true];
                continue;
            }
            $p = $bySlot[$slot];
            $isYou = $viewerId !== null && $viewerId === $p['id'];
            $entry = [
                'slot' => $slot,
                'empty' => false,
                'id' => $p['id'],
                'isHost' => $game['hostId'] === $p['id'],
                'isYou' => $isYou,
                'connected' => self::isConnected($p, $now),
                'isAI' => !empty($p['isAI']),
                'portraitSeed' => $p['portraitSeed'] ?? null,
                'profileName' => $p['profileName'] ?? null,
                'partyId' => $p['partyId'],
                'candidateName' => $p['candidateName'],
                'slogan' => $p['slogan'],
                // Money, broken down. Cash and debt are separate numbers and
                // stay separate all the way to the screen — a player carrying
                // two crore of borrowing should never see it dressed up as
                // two crore of budget.
                'budget' => (int) ($p['budget'] ?? 0),
                'cash' => (int) ($p['cash'] ?? 0),
                'spent' => (int) ($p['spent'] ?? 0),
                'remaining' => (int) ($p['cash'] ?? 0),
                'borrowed' => (int) ($p['borrowed'] ?? 0),
                'repaid' => (int) ($p['repaid'] ?? 0),
                'interestPaid' => (int) ($p['interestPaid'] ?? 0),
                'granted' => (int) ($p['granted'] ?? 0),
                'incomeTotal' => (int) ($p['incomeTotal'] ?? 0),
                'grantTotalEarned' => (int) ($p['grantTotalEarned'] ?? 0),
                'raised' => (int) ($p['raised'] ?? 0),
                'finesPaid' => (int) ($p['finesPaid'] ?? 0),
                'debt' => self::debtOf($p),
                'loanCount' => count(array_filter(
                    $p['loans'] ?? [],
                    static fn($l) => empty($l['settled'])
                )),
                'defaults' => (int) ($p['defaults'] ?? 0),
                'heat' => (float) ($p['heat'] ?? 0),
                'seatsLed' => (int) ($p['seatsLed'] ?? 0),
                'roundActions' => (int) ($p['roundActions'] ?? 0),
                'ready' => (bool) $p['ready'],
                'complete' => self::playerIsComplete($p),

                // Where the round stands for this player. Everyone can see
                // who has finished — that is the point of the ready count —
                // and everyone can see how many districts somebody holds,
                // because holding a district is written across the map.
                'roundReady' => !empty($p['roundReady']),
                'roundSpent' => (int) ($p['roundSpent'] ?? 0),
                'districtsHeld' => (int) ($p['districtsHeld'] ?? 0),
                'eliminated' => !empty($p['eliminated']),
                'allyId' => $p['allyId'] ?? null,

                // Public oversight figures. Everyone can see how many
                // reports stand against a player and whether they have been
                // penalised; the evidence score behind an investigation is
                // never sent to anyone.
                'reportsAgainst' => count($p['record']['reportsAgainst'] ?? []),
                'penalties' => count($p['record']['penalties'] ?? []),
                'restricted' => Investigation::isRestricted($p, (int) ($game['turn'] ?? 1)),
                'disqualified' => !empty($p['record']['disqualified']),
                'investigations' => $p['record']['investigations'] ?? [],
                'youReported' => $viewerId !== null
                    && isset($p['record']['reportsAgainst'][$viewerId]),
            ];
            // The board is shared, but what a player did to it is not. Only
            // ever ship a player their own action log, their own loans and
            // their own round summary — a rival's secret spending stays
            // secret, which is the point of playing risky moves at all.
            if ($isYou) {
                $entry['actions'] = array_slice($p['actions'] ?? [], -12);
                $entry['loans'] = array_values(array_filter(
                    $p['loans'] ?? [],
                    static fn($l) => empty($l['settled'])
                ));
                $entry['loanHistory'] = $p['loans'] ?? [];
                $entry['summary'] = $p['summary'] ?? null;
                $entry['borrowingBlocked'] = !empty($p['borrowingBlocked']);

                // Your own purses and your own account of them. A rival's
                // region balances would tell them exactly where you can
                // afford to fight, which is the whole game.
                $entry['grants'] = (object) ($p['grants'] ?? []);
                $entry['ledger'] = array_slice($p['ledger'] ?? [], -60);
                $entry['incomeTotal'] = (int) ($p['incomeTotal'] ?? 0);
                $entry['grantTotalEarned'] = (int) ($p['grantTotalEarned'] ?? 0);
                $entry['priorityDistricts'] = array_values($p['priorityDistricts'] ?? []);
            }

            // Allies plan together, so they see each other's priority
            // districts — and nothing else. Not their cash, not their heat,
            // not what they did quietly.
            if (!$isYou && $viewerId !== null
                && ($p['allyId'] ?? null) === $viewerId
                && ($game['players'][$viewerId]['allyId'] ?? null) === $p['id']) {
                $entry['priorityDistricts'] = array_values($p['priorityDistricts'] ?? []);
            }
            $slots[] = $entry;
        }

        $board = $game['board'] ?? [];
        $board = is_array($board) ? $board : (array) $board;
        $seats = self::seatCounts($board);

        [$readyCount, $readyOf] = Rounds::readyCount($game);

        return [
            'code' => $game['code'],
            'phase' => $game['phase'],
            'turn' => (int) $game['turn'],

            // The ready count, so every client can show the same "3 / 4" and
            // nobody has to work it out from a list of players.
            'readyCount' => $readyCount,
            'readyOf' => $readyOf,
            'roundState' => (string) ($game['roundState'] ?? 'active'),
            'alliances' => array_values($game['alliances'] ?? []),
            'allianceOffers' => $viewerId === null
                ? []
                : Alliances::offersTo($game, $viewerId),
            'eliminations' => array_values($game['eliminations'] ?? []),

            // The clock, as the server sees it. Clients work out the seconds
            // remaining from serverNow and roundEndsAt rather than from their
            // own clock, so a machine set to the wrong time still plays the
            // same round as everybody else.
            'round' => (int) ($game['round'] ?? 0),
            'roundsTotal' => (int) ($game['roundsTotal'] ?? 0),
            'roundSeconds' => (int) ($game['roundSeconds'] ?? 0),
            'roundStartedAt' => (int) ($game['roundStartedAt'] ?? 0),
            'roundEndsAt' => (int) ($game['roundEndsAt'] ?? 0),
            'secondsLeft' => max(0, (int) ($game['roundEndsAt'] ?? 0) - $now),
            'serverNow' => $now,

            // The results break: which stage the round is in, and how long is
            // left of it. Clients lock their controls on this rather than on
            // their own reading of the clock.
            'stage' => $game['stage'] ?? 'lobby',
            'intermissionSeconds' => (int) ($game['intermissionSeconds'] ?? 0),
            'nextRoundAt' => (int) ($game['nextRoundAt'] ?? 0),
            'intermissionLeft' => ($game['stage'] ?? '') === 'results'
                ? max(0, (int) ($game['nextRoundAt'] ?? 0) - $now)
                : 0,

            // The round's scoreboard, worked out once on the server so every
            // client shows identical figures.
            'lastResult' => $game['lastResult'] ?? null,
            'leaders' => $game['leaders'] ?? (object) [],

            // One board, seen by everyone.
            'board' => $board ?: (object) [],
            'projected' => $seats,
            'seatTrend' => array_map(
                static fn($h) => ['round' => (int) $h['round'], 'seats' => $h['seats']],
                $game['history'] ?? []
            ),
            'maxPlayers' => self::MAX_PLAYERS,
            'minPlayers' => self::MIN_PLAYERS,
            'playerCount' => count($game['players']),
            'connectedCount' => count(self::connectedPlayers($game)),
            'hostId' => $game['hostId'],
            'youAreHost' => $viewerId !== null && $viewerId === $game['hostId'],
            'players' => $slots,
            'takenParties' => self::takenParties($game),
            'startBlockedReason' => self::startBlockedReason($game),
            'incumbency' => $game['incumbency'] ?? null,
            'result' => $game['result'] ?? null,
            'coalition' => $game['coalition'] ?? null,
            'possibleCoalitions' => $game['possibleCoalitions'] ?? [],
            'lastInvestigation' => $game['lastInvestigation'] ?? null,
            'updatedAt' => (int) $game['updatedAt'],
        ];
    }
}
