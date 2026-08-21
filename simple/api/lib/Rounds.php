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
 * The pipeline below runs in a fixed order because the steps feed each other:
 * money settles before events, events move support, and only then is it
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
        $game['roundStartedAt'] = $now;
        $game['roundEndsAt'] = $now + (int) $cfg['seconds'];

        // Kept on the record so the lobby view can describe the clock without
        // needing the config loaded.
        $game['roundsTotal'] = (int) $cfg['total'];
        $game['roundSeconds'] = (int) $cfg['seconds'];

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
        $now = $now ?? time();
        $grace = (int) ($engine->rounds()['graceSeconds'] ?? 0);
        return $now <= ((int) ($game['roundEndsAt'] ?? 0) + $grace);
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

        while (($game['phase'] ?? '') === 'election'
            && $now >= (int) ($game['roundEndsAt'] ?? 0)
            && $guard++ < 40) {
            $game = self::endRound($game, $engine, $election);
        }
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

        // 9. On to the next round, or to the count.
        if ($round >= (int) $engine->rounds()['total']) {
            $result = $election->run($game);
            $game['result'] = $result;
            $game['phase'] = $result['outcome'] === 'majority' ? 'government' : 'hung';
            $game['possibleCoalitions'] = $election->possibleCoalitions($result);
            $game['roundEndsAt'] = time();
        } else {
            $game = self::begin($game, $round + 1, $engine);
        }

        $game['updatedAt'] = time();
        return $game;
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
