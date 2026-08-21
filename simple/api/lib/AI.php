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
            $player = self::maybeBorrow($player, $engine, $round, $rand, $board);
        }

        // Money owed this round or next is not money to spend. An opponent
        // that spent its way into a default would hand the game away for
        // nothing, which is not a rival so much as a bystander.
        // Everything owed, not merely what falls due this round. A loan taken
        // in round five is due in round seven, and an opponent that spent
        // freely in round five would have nothing left when the bill arrived.
        $reserve = $engine->debtOf($player);

        /*
         * A round is bounded by money now, not by a move counter.
         *
         * An opponent plays until it runs out of things it can afford or
         * decides it would rather save — chooseAction returns null for both.
         * The ceiling is a runaway backstop, not a rule: without it a bad
         * config could spin here forever inside a request holding the lock.
         */
        $allowed = 24;
        $player['roundActions'] = 0;

        for ($move = 0; $move < $allowed; $move++) {
            $action = self::chooseAction($player, $engine, $profile, $rand, $round, $reserve);
            if ($action === null) {
                break;
            }

            $target = null;
            if (!empty($action['needsConstituency'])) {
                $target = self::chooseSeat($board, $partyId, $profile, $rand, $engine, $player);
                if ($target === null) {
                    break;
                }
            }

            // How much goes behind it: cash spread over the moves still to
            // come, plus whatever the region purse can add.
            $amount = self::chooseAmount($player, $action, $engine, $round, $target);

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
    private static function chooseAmount(
        array $player,
        array $action,
        Campaign $engine,
        int $round,
        $target = null
    ): ?int {
        if (empty($action['allowsAmount'])) {
            return null;
        }
        /*
         * How much to put behind one move.
         *
         * Money carries forward now, so an opponent that spent everything the
         * moment it arrived would never mount the big push that the economy
         * is built around. It plans against the rounds it has left rather
         * than the moves, holding back roughly half of what it could spend so
         * something accumulates.
         */
        $rounds = $engine->rounds();
        $roundsLeft = max(1, (int) $rounds['total'] - $round + 1);

        /*
         * Against what this particular move can draw on — cash plus the purse
         * for its own region — rather than against cash alone. Grant money is
         * region-locked and cannot be saved for later somewhere else, so
         * there is nothing to gain by holding it back.
         */
        $pot = $engine->spendableOn($player, $target);
        $budget = (int) floor($pot['cash'] / max(2, min(6, $roundsLeft))) + $pot['grant'];

        $range = $engine->amountRange($action);
        return (int) max($range['min'], min($range['max'], $budget));
    }

    /**
     * The most one move could possibly put behind itself: general cash plus
     * the largest single region purse, because a move lands in one region.
     */
    private static function spendableCeiling(array $player, Campaign $engine): int
    {
        $best = 0;
        foreach (($player['grants'] ?? []) as $amount) {
            $best = max($best, max(0, (int) $amount));
        }
        return $engine->remaining($player) + $best;
    }

    /**
     * The region holding the most grant money, if it is worth aiming at.
     *
     * Money that can only be spent in Malwa should be spent in Malwa. An
     * opponent that campaigned wherever the closest race happened to be would
     * strand its grant income the moment it lost the district that earned it.
     */
    private static function richestRegion(array $player, int $floor): ?string
    {
        $best = null;
        $bestAmount = $floor;
        foreach (($player['grants'] ?? []) as $region => $amount) {
            $amount = max(0, (int) $amount);
            if ($amount > $bestAmount) {
                $bestAmount = $amount;
                $best = (string) $region;
            }
        }
        return $best;
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
        /*
         * Grant money is money.
         *
         * It is locked to the region that earned it, so it cannot be added to
         * the cash pile — but any one move lands in exactly one region, and
         * can draw that region's purse in full. The biggest purse is
         * therefore the right ceiling for "can this opponent afford to play at
         * all": counting only cash left it sitting on tens of crores of grant
         * income while it declared itself broke.
         */
        $spendable = max(0, self::spendableCeiling($player, $engine) - $reserve);
        $heat = (float) ($player['heat'] ?? 0);
        $heatMax = (float) $engine->config()['heat']['max'];
        $restricted = Investigation::isRestricted($player, $round);

        /*
         * Heat is a dial the opponent watches, and it stops turning it well
         * before the ceiling.
         *
         * Consequences fire at heat/100 of a chance on every action, floored
         * below minHeat — so once heat is past that floor, every move the
         * opponent makes is rolling against itself, and a round is now as
         * many moves as the money buys rather than three. Sitting at seventy
         * used to cost a little; it now costs on every move of every round.
         *
         * So the line is drawn where consequences actually begin, and the
         * per-round cooling is left to bring it back down.
         */
        $config = $engine->config();
        $backoff = (float) ($config['ai']['heatBackoff'] ?? 0.5);
        $consequencesFrom = (float) ($config['heat']['minHeat'] ?? $heatMax);
        $runningHot = $heat >= min($heatMax * $backoff, $consequencesFrom);

        $affordable = [];
        foreach ($engine->actions() as $action) {
            if ((int) $action['cost'] > $spendable) {
                continue;
            }
            $group = $action['group'] ?? 'safe';

            /*
             * A risky move is only taken if it lands under the consequence
             * floor.
             *
             * Below that floor nothing fires at all; above it, every single
             * move of every round rolls against itself. Crossing the line for
             * one strategy therefore taxes the whole rest of the campaign,
             * which is a bad trade at any appetite — so the appetite decides
             * how readily the room below the floor is used, not whether to go
             * through it.
             */
            if ($group === 'risky') {
                if ($restricted || $runningHot) {
                    continue;
                }
                if ($heat + (float) ($action['heat'] ?? 0) >= $consequencesFrom) {
                    continue;
                }
            }
            // Undisclosed money is free and costs 24 heat, which is most of
            // the way through the floor on its own. Same rule as a risky
            // strategy: only if it lands under it.
            if ($action['id'] === 'underground'
                && ($runningHot || $heat + (float) ($action['heat'] ?? 0) >= $consequencesFrom)) {
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
        // Thin against what a round costs, not against a starting budget
        // nobody is given any more.
        $roundIncome = (int) (($engine->config()['income'] ?? [])['perRound'] ?? 0);
        if ($spendable < $roundIncome * 0.35 && $rand() < 0.3) {
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
     * The district worth finishing.
     *
     * A district pays its grant every round for the rest of the game, so the
     * two seats that complete one are worth far more than two seats anywhere
     * else — and a player who works that out is fifteen seats ahead of an
     * opponent that only ever plays the closest race. Value is the grant over
     * the square of what is still missing, so a district needing one seat
     * beats a richer one needing four.
     *
     * Districts already held when the board was dealt pay nothing, so
     * finishing one of those is worth no more than any other seat.
     *
     * @return string[] the seats still missing from the best district
     */
    private static function districtTarget(
        array $board,
        string $partyId,
        Campaign $engine,
        array $player
    ): array {
        $leaders = Territory::leadersOf($board);
        $opening = $player['openingDistricts'] ?? [];

        $bestValue = 0.0;
        $bestMissing = [];

        foreach ($engine->territory()->districts() as $d) {
            if (in_array($d['id'], $opening, true)) {
                continue;
            }

            $missing = [];
            foreach ($d['seats'] as $number) {
                if (($leaders[(string) $number] ?? null) !== $partyId) {
                    $missing[] = (string) $number;
                }
            }
            if ($missing === [] || count($missing) > 3) {
                continue;
            }

            $value = (float) $d['grant'] / (count($missing) ** 2);
            if ($value > $bestValue) {
                $bestValue = $value;
                $bestMissing = $missing;
            }
        }

        return $bestMissing;
    }

    /**
     * Where to campaign: among the seats this party is closest to taking or
     * losing, since that is where a move changes the seat count. targetSpread
     * widens the shortlist, so a loose profile spreads itself thinner.
     *
     * Unless a district is nearly complete — finishing one buys income as
     * well as a seat, and that is the difference between an opponent and a
     * bystander.
     */
    private static function chooseSeat(
        array $board,
        string $partyId,
        array $profile,
        callable $rand,
        ?Campaign $engine = null,
        array $player = []
    ): ?string {
        if (!$board) {
            return null;
        }

        $closest = static function (array $keys) use ($board, $partyId): array {
            $margins = [];
            foreach ($keys as $key) {
                $seat = $board[(string) $key] ?? null;
                if ($seat === null) {
                    continue;
                }
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
            // array_keys hands back ints for numeric string keys, and the
            // board is keyed by string throughout, so put them back.
            return array_map('strval', array_keys($margins));
        };

        /*
         * Not every move, or the opponent would tunnel on one district while
         * the rest of the board walked away from it. Often enough that
         * holding ground is part of how it plays.
         */
        $appetite = (float) ($profile['territoryFocus'] ?? 0.45);
        if ($engine !== null && $rand() < $appetite) {
            $missing = self::districtTarget($board, $partyId, $engine, $player);
            if ($missing !== []) {
                $near = $closest($missing);
                if ($near !== []) {
                    return $near[0];
                }
            }
        }

        /*
         * Otherwise, if a region is holding real grant money, campaign there.
         * The purse cannot be moved and cannot be saved for anywhere else, so
         * a close race in the wrong region is worth less than a slightly
         * wider one that the grant will actually pay for.
         */
        if ($engine !== null) {
            $region = self::richestRegion($player, (int) ($engine->config()['actions'][0]['cost'] ?? 0));
            if ($region !== null) {
                $inRegion = [];
                foreach (array_keys($board) as $key) {
                    if ($engine->territory()->regionOfSeat($key) === $region) {
                        $inRegion[] = (string) $key;
                    }
                }
                if ($inRegion !== []) {
                    $near = $closest($inRegion);
                    $spread = max(1, (int) $profile['targetSpread']);
                    $pool = array_slice($near, 0, $spread);
                    return $pool[(int) floor($rand() * count($pool)) % count($pool)];
                }
            }
        }

        $shortlist = array_slice($closest(array_keys($board)), 0, max(1, (int) $profile['targetSpread']));
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
        callable $rand,
        array $board = []
    ): array {
        // Borrow when the purse is thin against what a round costs, not
        // against a starting budget nobody is given any more.
        $cash = $engine->remaining($player);
        $roundIncome = (int) (($engine->config()['income'] ?? [])['perRound'] ?? 0);
        if ($cash > $roundIncome) {
            return $player;
        }
        if ($engine->debtOf($player) > 0) {
            return $player; // one at a time
        }

        $cfg = $engine->finance()['loan'];
        $amount = (int) $cfg['minAmount']
            + (int) (floor($rand() * 4) * (int) $cfg['increments']);

        // The lender now works out what this campaign can service, so an
        // opponent asks for what it wants and takes whatever it is offered.
        $offer = $engine->loanOffer($player, $amount, $round, $board);
        if (!$offer['ok']) {
            $most = (int) ($offer['maxAffordable'] ?? 0);
            if ($most < (int) $engine->finance()['loan']['minAmount']) {
                return $player;
            }
            $offer = $engine->loanOffer($player, $most, $round, $board);
            if (!$offer['ok']) {
                return $player;
            }
        }
        [$player] = $engine->takeLoan($player, $offer['amount'], $round, $board);
        return $player;
    }
}
