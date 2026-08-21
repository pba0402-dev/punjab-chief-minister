<?php
/**
 * Opponents for the parties nobody is playing.
 * ------------------------------------------------------------------
 * The scoreboard is meant to show four competitors. When two people sit down
 * together, the other two parties still have to campaign, or half the board is
 * scenery and the leaderboard is a two-horse race dressed up as an election.
 *
 * These opponents play by exactly the same rules as a human. They call the
 * same Campaign::play, spend from the same starting grant, roll on the same
 * weighted outcome tables, take the same heat, run into the same consequences
 * and are held to the same three moves a round. They get no extra information
 * and no extra money — an AI that cheated would be obvious within two rounds,
 * and the point of them is to make the numbers on the scoreboard mean
 * something.
 *
 * What separates them is temperament, from the profiles in the config: how
 * much risk each will take, how tightly it targets, and how readily it
 * borrows. Three opponents in a solo game should not all play the same way.
 *
 * Names are drawn from ordinary Punjabi given names and surnames combined at
 * random. They are invented candidates, like the human players' own, and are
 * kept firmly apart from the real sitting MLAs the game shows as reference.
 */
declare(strict_types=1);

final class AI
{
    /**
     * Build an opponent for one party. Everything is derived from the seed, so
     * the same game always produces the same rival with the same name, the
     * same face and the same temperament.
     */
    public static function newPlayer(
        int $slot,
        string $partyId,
        string $seed,
        Campaign $engine
    ): array {
        $cfg = $engine->config()['ai'];
        $rand = Campaign::seededSequence($seed . ':ai:' . $partyId);

        $pick = static function (array $list) use ($rand) {
            return $list[(int) floor($rand() * count($list)) % count($list)];
        };

        $profile = $pick($cfg['profiles']);
        $given = $pick($cfg['givenNames']);
        $surname = $pick($cfg['surnames']);
        $slogan = $pick($cfg['slogans']);

        $player = Lobby::newPlayer($slot, $engine->startingBudget());
        $player['id'] = 'ai-' . $partyId;
        $player['token'] = '';           // nothing can authenticate as an opponent
        $player['isAI'] = true;
        $player['profileId'] = $profile['id'];
        $player['partyId'] = $partyId;
        $player['candidateName'] = $given . ' ' . $surname;
        $player['slogan'] = $slogan;
        $player['portraitSeed'] = $seed . ':' . $partyId;
        $player['ready'] = true;
        $player['lastSeen'] = time();

        return $player;
    }

    /** The profile this opponent plays to. */
    public static function profileFor(array $player, Campaign $engine): array
    {
        $profiles = $engine->config()['ai']['profiles'];
        foreach ($profiles as $p) {
            if ($p['id'] === ($player['profileId'] ?? '')) {
                return $p;
            }
        }
        return $profiles[0];
    }

    /**
     * One opponent's moves for a round. Returns [player, board, moves].
     *
     * Called once per round from the round-end pipeline, so an opponent's
     * campaigning lands in the same round as everybody else's and shows up in
     * the same results screen.
     */
    public static function takeRound(
        array $player,
        array $board,
        Campaign $engine,
        string $seed,
        int $round
    ): array {
        $moves = [];
        if (!empty($player['record']['disqualified'])) {
            return [$player, $board, $moves];
        }

        $profile = self::profileFor($player, $engine);
        $rand = Campaign::seededSequence($seed . ':aiturn:' . $player['partyId'] . ':' . $round);
        $partyId = (string) $player['partyId'];

        // Borrowing, before spending, so the money is available this round.
        if ($rand() < (float) $profile['borrowChance']) {
            $player = self::maybeBorrow($player, $engine, $round, $rand);
        }

        // Money owed this round or next is not money to spend. An opponent
        // that spent its way into a default would hand the game away for
        // nothing, which is not a rival so much as a bystander.
        // Everything owed, not merely what falls due this round. A loan taken
        // in round five is due in round seven, and an opponent that spent
        // freely in round five would have nothing left when the bill arrived.
        $reserve = $engine->debtOf($player);

        $allowed = (int) ($engine->rounds()['actionsPerRound'] ?? 3);
        $player['roundActions'] = 0;

        for ($move = 0; $move < $allowed; $move++) {
            $action = self::chooseAction($player, $engine, $profile, $rand, $round, $reserve);
            if ($action === null) {
                break;
            }

            $target = null;
            if (!empty($action['needsConstituency'])) {
                $target = self::chooseSeat($board, $partyId, $profile, $rand);
                if ($target === null) {
                    break;
                }
            }

            // How much to put behind it. Spreading evenly across the moves
            // available is the efficient play under a square-root curve, so
            // that is what an opponent does: its remaining cash divided by the
            // moves it expects to have left.
            $amount = self::chooseAmount($player, $action, $engine, $round);

            if ($engine->blockedReason($player, $board, $action['id'], $target, $amount) !== null) {
                break;
            }

            $rolls = Campaign::rollsFor(
                $seed . ':ai:' . $player['partyId'],
                (int) ($player['rollCount'] ?? 0)
            );
            $player['rollCount'] = (int) ($player['rollCount'] ?? 0) + 1;
            $player['round'] = $round;

            [$player, $board, $report] = $engine->play(
                $player,
                $board,
                $action['id'],
                $target,
                $rolls,
                $amount
            );
            $moves[] = [
                'actionId' => $report['actionId'],
                'label' => $report['label'],
                'constituency' => $report['constituency'],
                'support' => $report['support'],
            ];
        }

        return [$player, $board, $moves];
    }

    /**
     * How much to put behind a move. An opponent budgets rather than always
     * paying the sticker price: what it has left, divided by the moves it can
     * still expect to make, clamped to what the action allows.
     */
    private static function chooseAmount(array $player, array $action, Campaign $engine, int $round): ?int
    {
        if (empty($action['allowsAmount'])) {
            return null;
        }
        $rounds = $engine->rounds();
        $movesLeft = max(1, ((int) $rounds['total'] - $round + 1) * (int) $rounds['actionsPerRound']);
        $budget = (int) floor($engine->remaining($player) / $movesLeft);

        $range = $engine->amountRange($action);
        return (int) max($range['min'], min($range['max'], $budget));
    }

    /**
     * What to play next. Risky strategies are reached for in proportion to the
     * profile's appetite, and only while the heat is bearable — an opponent
     * that ran itself to a disqualification every game would be no opponent at
     * all. Funding is used when the money is running short.
     */
    private static function chooseAction(
        array $player,
        Campaign $engine,
        array $profile,
        callable $rand,
        int $round,
        int $reserve = 0
    ): ?array {
        $spendable = max(0, $engine->remaining($player) - $reserve);
        $heat = (float) ($player['heat'] ?? 0);
        $heatMax = (float) $engine->config()['heat']['max'];
        $restricted = Investigation::isRestricted($player, $round);

        // Heat is a dial the opponent watches. Past two thirds it stops
        // reaching for anything that would raise it further and lets the
        // per-round cooling bring it back down, the way a player who had been
        // paying attention would.
        $backoff = (float) ($engine->config()['ai']['heatBackoff'] ?? 0.5);
        $runningHot = $heat >= $heatMax * $backoff;

        $affordable = [];
        foreach ($engine->actions() as $action) {
            if ((int) $action['cost'] > $spendable) {
                continue;
            }
            $group = $action['group'] ?? 'safe';
            if ($group === 'risky' && ($restricted || $runningHot)) {
                continue;
            }
            if ($action['id'] === 'underground' && $runningHot) {
                continue;
            }
            $affordable[$group][] = $action;
        }

        $safe = $affordable['safe'] ?? [];
        $funding = $affordable['funding'] ?? [];

        // Nothing left to campaign with: raise money if that is still a
        // sensible thing to do, otherwise sit the round out. Taking
        // undisclosed money every round until the heat pins at a hundred is
        // not desperation, it is a bug wearing desperation's coat.
        if (!$safe) {
            $grant = self::findAction($funding, 'grant');
            if ($grant !== null) {
                return $grant;
            }
            $shady = self::findAction($funding, 'underground');
            if ($shady !== null && $rand() < (float) $profile['riskAppetite']) {
                return $shady;
            }
            return null;
        }

        if (!empty($affordable['risky']) && $rand() < (float) $profile['riskAppetite']) {
            $pool = $affordable['risky'];
            return $pool[(int) floor($rand() * count($pool)) % count($pool)];
        }

        // A grant is worth taking now and then: development work that also
        // pays for itself sometimes.
        if ($spendable < $engine->startingBudget() * 0.35 && $rand() < 0.3) {
            $grant = self::findAction($funding, 'grant');
            if ($grant !== null) {
                return $grant;
            }
        }

        return $safe[(int) floor($rand() * count($safe)) % count($safe)];
    }

    private static function findAction(array $pool, string $id): ?array
    {
        foreach ($pool as $action) {
            if ($action['id'] === $id) {
                return $action;
            }
        }
        return null;
    }

    /**
     * Where to campaign: among the seats this party is closest to taking or
     * losing, since that is where a move changes the seat count. targetSpread
     * widens the shortlist, so a loose profile spreads itself thinner.
     */
    private static function chooseSeat(
        array $board,
        string $partyId,
        array $profile,
        callable $rand
    ): ?string {
        if (!$board) {
            return null;
        }

        $margins = [];
        foreach ($board as $key => $seat) {
            $mine = (float) ($seat[$partyId] ?? 0);
            $best = 0.0;
            foreach ($seat as $pid => $value) {
                if ($pid !== $partyId && $value > $best) {
                    $best = (float) $value;
                }
            }
            $margins[(string) $key] = abs($mine - $best);
        }
        asort($margins);

        // array_keys hands back ints for numeric string keys, and the board is
        // keyed by string throughout, so put them back.
        $shortlist = array_slice(array_map('strval', array_keys($margins)), 0, max(1, (int) $profile['targetSpread']));
        return $shortlist[(int) floor($rand() * count($shortlist)) % count($shortlist)];
    }

    /**
     * Borrow when the purse is thin, the terms are open, and there is a
     * plausible way to pay it back. An opponent that borrowed into a certain
     * default would only be handing away heat and support.
     */
    private static function maybeBorrow(
        array $player,
        Campaign $engine,
        int $round,
        callable $rand
    ): array {
        $cash = $engine->remaining($player);
        if ($cash > $engine->startingBudget() * 0.3) {
            return $player;
        }
        if ($engine->debtOf($player) > 0) {
            return $player; // one at a time
        }

        $cfg = $engine->finance()['loan'];
        $amount = (int) $cfg['minAmount']
            + (int) (floor($rand() * 4) * (int) $cfg['increments']);

        $offer = $engine->loanOffer($player, $amount, $round);
        if (!$offer['ok']) {
            return $player;
        }
        // Borrow only what the cash in hand plus the loan could still cover
        // when the bill lands two rounds later.
        if ($cash + $offer['amount'] < $offer['repay']) {
            return $player;
        }
        [$player] = $engine->takeLoan($player, $offer['amount'], $round);
        return $player;
    }
}
