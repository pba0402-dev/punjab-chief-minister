<?php
/**
 * The round clock and the round-end pipeline.
 * ------------------------------------------------------------------
 * A campaign is fifteen rounds of sixty seconds. The clock belongs to the
 * server: roundStartedAt and roundEndsAt are server timestamps, every response
 * carries the server's own time, and clients derive the seconds remaining from
 * those. Nothing depends on a player's computer being set correctly, and a
 * refresh mid-round rejoins at the right second.
 *
 * Rounds turn over lazily. There is no cron job on shared hosting we can rely
 * on, so whichever request arrives first after the clock runs out does the
 * work, under the same lock as every other change. Clients poll every couple
 * of seconds, so in practice a round ends within a second or two of expiry —
 * and if every player closed their laptop, the round ends the moment one of
 * them comes back, which is the behaviour you want anyway.
 *
 * A round has two stages. While it is "playing", the sixty-second clock runs
 * and moves are accepted. When it expires the round is settled and the game
 * moves to "results": play is locked, the scoreboard is built once on the
 * server, and every client is shown the same figures for a few seconds before
 * the next round opens. The break is deliberate — reading what just happened
 * should not be competing with the next round for the same seconds.
 *
 * The pipeline below runs in a fixed order because the steps feed each other:
 * opponents move, money settles, events move support, and only then is it
 * meaningful to recount leaders and projected seats.
 */
declare(strict_types=1);

final class Rounds
{
    /** Start a round and stamp its deadline. */
    public static function begin(array $game, int $round, Campaign $engine): array
    {
        $cfg = $engine->rounds();
        $now = time();
        $game['round'] = $round;
        $game['stage'] = 'playing';
        $game['roundStartedAt'] = $now;
        $game['roundEndsAt'] = $now + (int) $cfg['seconds'];
        $game['nextRoundAt'] = 0;

        // Kept on the record so the lobby view can describe the clock without
        // needing the config loaded.
        $game['roundsTotal'] = (int) $cfg['total'];
        $game['roundSeconds'] = (int) $cfg['seconds'];
        $game['intermissionSeconds'] = (int) $cfg['intermissionSeconds'];

        // turn tracks rounds one-for-one. Restrictions and investigations were
        // written against it before rounds existed and still read it.
        $game['turn'] = $round;

        // Snapshot what each player looked like as the round opened. The
        // summary at the end is a diff against this, so "money spent" means
        // money spent this round rather than whatever was left when the
        // pipeline happened to look.
        $board = self::boardOf($game);
        foreach ($game['players'] as $pid => $p) {
            $partyId = (string) ($p['partyId'] ?? '');
            $game['players'][$pid]['roundActions'] = 0;
            $game['players'][$pid]['roundSpent'] = 0;
            $game['players'][$pid]['roundGained'] = 0;
            $game['players'][$pid]['round'] = $round;
            $game['players'][$pid]['roundOpen'] = [
                'cash' => (int) ($p['cash'] ?? 0),
                'heat' => (float) ($p['heat'] ?? 0),
                'seats' => (int) ($p['seatsLed'] ?? 0),
                'support' => $partyId === '' ? 0.0 : $engine->averageSupport($board, $partyId),
            ];
        }
        return $game;
    }

    public static function secondsLeft(array $game, ?int $now = null): int
    {
        if (($game['phase'] ?? '') !== 'election') {
            return 0;
        }
        $now = $now ?? time();
        return max(0, (int) ($game['roundEndsAt'] ?? 0) - $now);
    }

    /**
     * May a player still act? The grace window forgives a click that was in
     * flight as the clock hit zero — a player should lose a round to their own
     * hesitation, not to their latency.
     */
    public static function isLive(array $game, Campaign $engine, ?int $now = null): bool
    {
        if (($game['phase'] ?? '') !== 'election') {
            return false;
        }
        // Play is locked for the whole results break, not merely until the
        // clock hits zero — the scoreboard being shown is the same scoreboard
        // a late move would invalidate.
        if (($game['stage'] ?? 'playing') !== 'playing') {
            return false;
        }
        $now = $now ?? time();
        $grace = (int) ($engine->rounds()['graceSeconds'] ?? 0);
        return $now <= ((int) ($game['roundEndsAt'] ?? 0) + $grace);
    }

    /** Seconds left in the results break, or 0 when a round is running. */
    public static function intermissionLeft(array $game, ?int $now = null): int
    {
        if (($game['stage'] ?? 'playing') !== 'results') {
            return 0;
        }
        return max(0, (int) ($game['nextRoundAt'] ?? 0) - ($now ?? time()));
    }

    public static function isFinalRound(array $game, Campaign $engine): bool
    {
        return (int) ($game['round'] ?? 0) >= (int) $engine->rounds()['total'];
    }

    /**
     * If the clock has run out, end the round — repeatedly, because a game
     * left alone for five minutes has several rounds owing. Returns the game
     * unchanged when there is nothing due, so callers can run this on every
     * request cheaply.
     */
    public static function advanceIfDue(array $game, Campaign $engine, Election $election, ?int $now = null): array
    {
        if (($game['phase'] ?? '') !== 'election') {
            return $game;
        }
        $now = $now ?? time();
        $guard = 0;

        // Two things can be owed: a round that has finished playing and needs
        // settling, and a results break that has run its course. A game left
        // alone for five minutes may owe several of each, so keep going until
        // nothing is due.
        while (($game['phase'] ?? '') === 'election' && $guard++ < 60) {
            $stage = $game['stage'] ?? 'playing';

            if ($stage === 'playing' && $now >= (int) ($game['roundEndsAt'] ?? 0)) {
                $game = self::endRound($game, $engine, $election);
                continue;
            }
            if ($stage === 'results' && $now >= (int) ($game['nextRoundAt'] ?? 0)) {
                $game = self::startNextRound($game, $engine, $election);
                continue;
            }
            break;
        }
        return $game;
    }

    /** Leave the results break and open the next round, or close the polls. */
    public static function startNextRound(array $game, Campaign $engine, Election $election): array
    {
        $round = (int) ($game['round'] ?? 1);

        if ($round >= (int) $engine->rounds()['total']) {
            $result = $election->run($game);
            $game['result'] = $result;
            $game['phase'] = $result['outcome'] === 'majority' ? 'government' : 'hung';
            $game['stage'] = 'final';
            $game['roundEndsAt'] = time();
            $game['nextRoundAt'] = 0;
            $game['possibleCoalitions'] = $election->possibleCoalitions($result);
            $game['updatedAt'] = time();
            return $game;
        }

        $game = self::begin($game, $round + 1, $engine);
        $game['updatedAt'] = time();
        return $game;
    }

    /* ------------------------------------------------------------ pipeline */

    /**
     * One full round end. Every step writes into a per-player summary so the
     * round-end screen can say what happened rather than leaving a player to
     * infer it from a changed number.
     */
    public static function endRound(array $game, Campaign $engine, Election $election): array
    {
        $round = (int) ($game['round'] ?? 1);
        $rand = Campaign::seededSequence($game['id'] . ':round:' . $round);

        $board = self::boardOf($game);
        $summaries = [];

        $order = array_map('strval', array_keys($game['players']));
        sort($order); // deterministic regardless of join order

        // 0. The opponents campaign. They move at the end of the round rather
        // than at odd moments during it, so their spending lands in the same
        // round as everybody else's and appears in the same results screen.
        $aiMoves = [];
        foreach ($order as $pid) {
            $player = $game['players'][$pid];
            if (empty($player['isAI']) || empty($player['partyId'])) {
                continue;
            }
            [$player, $board, $moves] = AI::takeRound($player, $board, $engine, $game['id'], $round);
            $game['players'][$pid] = $player;
            $aiMoves[$pid] = $moves;
        }

        // 1 + 2. Campaign effects have already been applied as each action was
        // played; what is still owed is money. Loans fall due here.
        foreach ($order as $pid) {
            $player = $game['players'][$pid];
            $summary = self::blankSummary($player, $round);

            [$player, $summary] = $engine->settleLoans($player, $round, $summary);
            $game['players'][$pid] = $player;
            $summaries[$pid] = $summary;
        }

        // 3 + 4. At most one event each, most rounds none at all. Events land
        // on named seats and move the shared board like anything else.
        foreach ($order as $pid) {
            $player = $game['players'][$pid];
            if (empty($player['partyId']) || !empty($player['record']['disqualified'])) {
                continue;
            }
            [$player, $board, $event] = $engine->rollEvent($player, $board, $rand);
            $game['players'][$pid] = $player;
            if ($event !== null) {
                $summaries[$pid]['events'][] = $event;
            }
        }

        // 7. Heat cools a little between rounds. Without it heat only ever
        // climbs, so one risky round would mark a player for the rest of the
        // campaign and the whole risk system becomes a one-way door.
        foreach ($order as $pid) {
            $player = $game['players'][$pid];
            $player['heat'] = $engine->coolHeat((float) ($player['heat'] ?? 0));
            $game['players'][$pid] = $player;
            $summaries[$pid]['heatAfter'] = (float) $player['heat'];
        }

        // 5 + 6. Leaders and projected seats, recounted once from the settled
        // board so every client is reading the same arithmetic.
        $game['board'] = $board;
        $seats = $engine->seatCounts($board);

        foreach ($order as $pid) {
            $player = $game['players'][$pid];
            $partyId = (string) ($player['partyId'] ?? '');
            $player['seatsLed'] = $partyId === '' ? 0 : (int) ($seats[$partyId] ?? 0);

            $s = $summaries[$pid];
            $s['spent'] = (int) ($player['roundSpent'] ?? 0);
            $s['gained'] = (int) ($player['roundGained'] ?? 0);
            $s['seatsAfter'] = (int) $player['seatsLed'];
            $s['seatsChange'] = $s['seatsAfter'] - $s['seatsBefore'];
            $s['cashAfter'] = (int) $player['cash'];
            $s['cashChange'] = $s['cashAfter'] - $s['cashBefore'];
            $s['debtAfter'] = $engine->debtOf($player);
            $s['heatChange'] = round($s['heatAfter'] - $s['heatBefore'], 1);
            $s['supportAfter'] = $partyId === '' ? 0.0 : $engine->averageSupport($board, $partyId);
            $s['supportChange'] = round($s['supportAfter'] - $s['supportBefore'], 1);

            $player['summary'] = $s;
            $summaries[$pid] = $s;
            $game['players'][$pid] = $player;
        }

        // 7. Which seats changed hands. Only the differences are worth
        // showing: early rounds can settle a hundred seats at once, and a
        // list of all 117 every round is a wall of text nobody reads.
        $previous = self::leadersOf($game);
        $current = self::currentLeaders($board);
        $changes = self::diffLeaders($previous, $current);
        $game['leaders'] = $current;

        // 8. A snapshot per round, so the constituency panel can draw how a
        // race moved rather than only where it ended up.
        $game['history'][] = [
            'round' => $round,
            'seats' => $seats,
            'board' => $board,
        ];
        $game['roundLog'][] = [
            'round' => $round,
            'seats' => $seats,
            'at' => time(),
        ];
        if (count($game['roundLog']) > 20) {
            array_shift($game['roundLog']);
        }

        // 9. Build the scoreboard once, here, and hand every client the same
        // one. A client that worked out its own standings could disagree with
        // the player sitting next to it, which would make the whole screen
        // untrustworthy.
        $game['lastResult'] = self::buildResult($game, $engine, $round, $seats, $changes, $summaries, $aiMoves);

        $game['leadParty'] = $game['lastResult']['leadParty'];

        // 10. Into the results break. The next round opens when it expires.
        //
        // The break is measured from when the round actually ended, not from
        // the moment we noticed it had. A game nobody touched for five minutes
        // is settled by whichever request arrives next, and stamping the break
        // from "now" would leave it stuck on a scoreboard nobody was there to
        // read — one owed round at a time, forever.
        $game['stage'] = 'results';
        $game['nextRoundAt'] = (int) $game['roundEndsAt']
            + (int) $engine->rounds()['intermissionSeconds'];

        $game['updatedAt'] = time();
        return $game;
    }

    /* -------------------------------------------------------- scoreboard */

    /** Who leads each seat right now. */
    public static function currentLeaders(array $board): array
    {
        $out = [];
        foreach ($board as $key => $seat) {
            $leader = Campaign::leaderOf($seat);
            if ($leader !== null) {
                $out[(string) $key] = $leader;
            }
        }
        return $out;
    }

    /** The leader map as it stood after the previous round. */
    public static function leadersOf(array $game): array
    {
        $leaders = $game['leaders'] ?? [];
        return is_array($leaders) ? $leaders : (array) $leaders;
    }

    /**
     * Seats that changed hands, as {seat, from, to}. A first round has no
     * previous state to compare against, so nothing is reported as a change —
     * every seat "changing" on the opening round would be meaningless.
     */
    public static function diffLeaders(array $previous, array $current): array
    {
        if (!$previous) {
            return [];
        }
        $changes = [];
        foreach ($current as $key => $to) {
            $from = $previous[$key] ?? null;
            if ($from !== null && $from !== $to) {
                $changes[] = ['seat' => (int) $key, 'from' => $from, 'to' => $to];
            }
        }
        usort($changes, static fn($a, $b) => $a['seat'] <=> $b['seat']);
        return $changes;
    }

    /**
     * The round's scoreboard: who is where, what moved, and what it means.
     * Everything a client needs to draw the results screen without doing any
     * arithmetic of its own.
     */
    public static function buildResult(
        array $game,
        Campaign $engine,
        int $round,
        array $seats,
        array $changes,
        array $summaries,
        array $aiMoves
    ): array {
        $cfg = $engine->config()['scoreboard'];
        $majority = (int) $engine->config()['election']['majority'];

        // One row per playable party, whoever is playing it.
        $byParty = [];
        foreach ($game['players'] as $pid => $p) {
            if (!empty($p['partyId'])) {
                $byParty[(string) $p['partyId']] = $pid;
            }
        }

        $standings = [];
        foreach (Lobby::PARTIES as $partyId) {
            $pid = $byParty[$partyId] ?? null;
            $player = $pid !== null ? $game['players'][$pid] : null;
            $summary = $pid !== null ? ($summaries[$pid] ?? null) : null;

            $standings[] = [
                'party' => $partyId,
                'playerId' => $pid,
                'candidateName' => $player['candidateName'] ?? null,
                'portraitSeed' => $player['portraitSeed'] ?? null,
                'isAI' => !empty($player['isAI']),
                'seats' => (int) ($seats[$partyId] ?? 0),
                'change' => $summary !== null ? (int) $summary['seatsChange'] : 0,
                'heat' => $player !== null ? round((float) $player['heat'], 0) : 0,
                'disqualified' => !empty($player['record']['disqualified']),
                'moves' => $pid !== null ? ($aiMoves[$pid] ?? null) : null,
            ];
        }

        usort($standings, static function ($a, $b) {
            return $b['seats'] <=> $a['seats'] ?: strcmp($a['party'], $b['party']);
        });

        $leader = $standings[0];
        $runnerUp = $standings[1] ?? null;
        $gap = $runnerUp !== null ? $leader['seats'] - $runnerUp['seats'] : $leader['seats'];

        // Did the lead change hands this round?
        $previousLeader = $game['leadParty'] ?? null;
        $newLeader = $previousLeader !== null
            && $previousLeader !== $leader['party']
            && $leader['seats'] > 0;

        $shown = array_slice($changes, 0, (int) $cfg['maxSeatChangesShown']);

        return [
            'round' => $round,
            'roundsTotal' => (int) $engine->rounds()['total'],
            'isFinalRound' => $round >= (int) $engine->rounds()['total'],
            'standings' => $standings,
            'totalSeats' => array_sum($seats),
            'majority' => $majority,

            'leadParty' => $leader['party'],
            'leadSeats' => $leader['seats'],
            'leadOver' => $runnerUp['party'] ?? null,
            'leadGap' => $gap,
            'seatsNeeded' => max(0, $majority - $leader['seats']),
            'newLeader' => $newLeader,
            'previousLeader' => $previousLeader,
            'closeRace' => $runnerUp !== null && $gap <= (int) $cfg['closeRaceSeats'],

            'changes' => $shown,
            'changeCount' => count($changes),
            'changesHidden' => max(0, count($changes) - count($shown)),
            'at' => time(),
        ];
    }

    /** The shared board, tolerating the empty-object form JSON round-trips to. */
    public static function boardOf(array $game): array
    {
        $board = $game['board'] ?? [];
        return is_array($board) ? $board : (array) $board;
    }

    /**
     * The summary starts as a copy of what the round opened with; the pipeline
     * fills in what changed. Reading the opening figures from the snapshot
     * taken at begin() is the whole point — by the time this runs, the round's
     * spending has already happened.
     */
    private static function blankSummary(array $player, int $round): array
    {
        $open = $player['roundOpen'] ?? [
            'cash' => (int) ($player['cash'] ?? 0),
            'heat' => (float) ($player['heat'] ?? 0),
            'seats' => (int) ($player['seatsLed'] ?? 0),
            'support' => 0.0,
        ];
        return [
            'round' => $round,
            'cashBefore' => (int) $open['cash'],
            'cashAfter' => (int) ($player['cash'] ?? 0),
            'cashChange' => 0,
            'spent' => (int) ($player['roundSpent'] ?? 0),
            'gained' => (int) ($player['roundGained'] ?? 0),
            'debtAfter' => 0,
            'heatBefore' => (float) $open['heat'],
            'heatAfter' => (float) ($player['heat'] ?? 0),
            'heatChange' => 0.0,
            'seatsBefore' => (int) $open['seats'],
            'seatsAfter' => (int) ($player['seatsLed'] ?? 0),
            'seatsChange' => 0,
            'supportBefore' => (float) $open['support'],
            'supportAfter' => 0.0,
            'supportChange' => 0.0,
            'actionsPlayed' => (int) ($player['roundActions'] ?? 0),
            'repayments' => [],
            'events' => [],
        ];
    }

    /**
     * The history of one seat, thinned to what a chart needs. Sent only when a
     * client opens a constituency, because shipping fifteen full boards on
     * every poll would dwarf everything else in the response.
     */
    public static function seatHistory(array $game, string $key): array
    {
        $out = [];
        foreach (($game['history'] ?? []) as $snap) {
            $board = $snap['board'] ?? [];
            $board = is_array($board) ? $board : (array) $board;
            if (isset($board[$key])) {
                $out[] = ['round' => (int) $snap['round'], 'support' => $board[$key]];
            }
        }
        return $out;
    }

    /** Seat totals per party per round — small enough to ship on every poll. */
    public static function seatTrend(array $game): array
    {
        $out = [];
        foreach (($game['history'] ?? []) as $snap) {
            $out[] = ['round' => (int) $snap['round'], 'seats' => $snap['seats']];
        }
        return $out;
    }
}
