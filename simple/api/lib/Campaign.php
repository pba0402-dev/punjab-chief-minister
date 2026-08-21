<?php
/**
 * Campaign rules, server side.
 * ------------------------------------------------------------------
 * Multiplayer resolves actions here rather than in the browser, because a
 * client cannot be trusted to roll its own dice or deduct its own money.
 *
 * These are the same rules as js/engine/campaign.js, reading the same
 * campaign-config.json, and tools/test-campaign.mjs asserts the two agree on
 * outcome distributions, costs and heat. Each player's budget, spending,
 * heat and support are entirely their own.
 */
declare(strict_types=1);

final class Campaign
{
    private ?Territory $territory = null;

    private array $config;

    public function __construct(string $configPath)
    {
        $raw = @file_get_contents($configPath);
        if ($raw === false) {
            throw new RuntimeException('Campaign config missing at ' . $configPath);
        }
        $config = json_decode($raw, true);
        if (!is_array($config)) {
            throw new RuntimeException('Campaign config is not valid JSON.');
        }
        $this->config = $config;
    }

    public function config(): array
    {
        return $this->config;
    }

    public function startingBudget(): int
    {
        return (int) $this->config['startingBudget'];
    }

    /**
     * The round clock as configured.
     *
     * CMP_ROUND_SECONDS and CMP_INTERMISSION_SECONDS shorten a round and the
     * results break, and exist so the test suite can play all twenty rounds
     * against a real server in under a minute rather than a quarter of an
     * hour. The longer break at a milestone round is a multiple of this one,
     * so it shortens with it. Nothing sets them in production, and if they were ever set the
     * only effect would be a faster clock — no rule changes with either.
     */
    public function rounds(): array
    {
        $rounds = $this->config['rounds'];
        $override = getenv('CMP_ROUND_SECONDS');
        if ($override !== false && (int) $override > 0) {
            $rounds['seconds'] = (int) $override;
        }
        $break = getenv('CMP_INTERMISSION_SECONDS');
        if ($break !== false && (int) $break > 0) {
            $rounds['intermissionSeconds'] = (int) $break;
        }
        return $rounds;
    }

    public function finance(): array
    {
        return $this->config['finance'];
    }

    public function spending(): array
    {
        return $this->config['spending'];
    }

    /**
     * What a move is allowed to cost. An action's own cost is the middle of
     * the range rather than the price of it.
     */
    public function amountRange(array $action): array
    {
        $cfg = $this->spending();
        if (empty($cfg['enabled']) || empty($action['allowsAmount'])) {
            return ['min' => (int) $action['cost'], 'max' => (int) $action['cost']];
        }
        return [
            'min' => min((int) $cfg['minAmount'], (int) $action['cost']),
            'max' => (int) round((int) $action['cost'] * (float) $cfg['maxMultiple']),
        ];
    }

    /**
     * How far a given amount scales a move, against the action's base cost.
     *
     * A square root: four times the money buys twice the effect. For a fixed
     * budget that makes spreading money across every available move strictly
     * better than concentrating it, which is what stops a large purse simply
     * buying the election in a handful of expensive gestures.
     */
    public function scaleFor(array $action, int $amount): float
    {
        $cfg = $this->spending();
        $base = (int) $action['cost'];
        if (empty($cfg['enabled']) || empty($action['allowsAmount']) || $base <= 0) {
            return 1.0;
        }
        $curve = (float) ($cfg['curve'] ?? 0.5);
        $scale = pow($amount / $base, $curve);
        return self::clamp($scale, (float) $cfg['minScale'], (float) $cfg['maxScale']);
    }

    /** The amount a move will actually cost, clamped to what is allowed. */
    public function resolveAmount(array $action, $requested): int
    {
        $range = $this->amountRange($action);
        if ($requested === null || $requested === '') {
            return (int) $action['cost'];
        }
        return (int) self::clamp((float) (int) $requested, (float) $range['min'], (float) $range['max']);
    }

    /**
     * Every action a player can take, campaign strategies and the two ways of
     * raising money alike. The bribe menu, grants and underground funding are
     * all shaped like any other action — a cost, a weighted outcome table — so
     * play() resolves them the same way and the UI needs no special case.
     */
    public function actions(): array
    {
        $all = array_merge($this->config['actions'], $this->config['bribe']['actions'] ?? []);
        foreach (['grant', 'underground'] as $id) {
            $entry = $this->config['funding'][$id];
            $entry['group'] = 'funding';
            $all[] = $entry;
        }
        return $all;
    }

    public function action(string $id): ?array
    {
        foreach ($this->actions() as $a) {
            if ($a['id'] === $id) {
                return $a;
            }
        }
        return null;
    }

    private static function clamp(float $v, float $lo, float $hi): float
    {
        return $v < $lo ? $lo : ($v > $hi ? $hi : $v);
    }

    /**
     * One outcome, scaled by what the player put behind the move. Support,
     * the knock to an opponent, any money it brings in, and the heat it
     * raises all move together — a bigger effort is a more visible one.
     */
    public static function scaleOutcome(array $outcome, float $scale): array
    {
        if ($scale === 1.0) {
            return $outcome;
        }
        foreach (['support', 'opponentSupport', 'funds', 'heat'] as $field) {
            if (!empty($outcome[$field])) {
                $outcome[$field] = $field === 'funds'
                    ? (int) round($outcome[$field] * $scale)
                    : round($outcome[$field] * $scale, 2);
            }
        }
        return $outcome;
    }

    /** Pick one entry from a weighted list. $roll is a float in [0,1). */
    public static function weightedPick(array $items, float $roll): array
    {
        $total = 0;
        foreach ($items as $i) {
            $total += $i['weight'] ?? 0;
        }
        if ($total <= 0) {
            return $items[0];
        }
        $target = $roll * $total;
        foreach ($items as $i) {
            $target -= $i['weight'] ?? 0;
            if ($target < 0) {
                return $i;
            }
        }
        return $items[count($items) - 1];
    }

    public function heatLevel(float $heat): array
    {
        foreach ($this->config['heat']['levels'] as $level) {
            if ($heat <= $level['upTo']) {
                return $level;
            }
        }
        $levels = $this->config['heat']['levels'];
        return $levels[count($levels) - 1];
    }

    public function ratingFor(float $margin): array
    {
        foreach ($this->config['ratings'] as $r) {
            if ($margin >= $r['minMargin']) {
                return $r;
            }
        }
        $ratings = $this->config['ratings'];
        return $ratings[count($ratings) - 1];
    }

    /* ------------------------------------------------------------ support */

    /**
     * Opening political map, built from the real sitting MLAs.
     *
     * The party holding a seat starts ahead in it by an amount rolled per seat
     * from the game seed. Incumbents outside the four playable parties sit
     * under "oth". This is a starting position, not a prediction.
     *
     * $incumbents maps constituency number => real party code.
     * Returns [support, incumbency].
     */
    public function seedSupport(array $constituencies, array $partyIds, string $seed, array $incumbents): array
    {
        $rand = self::seededSequence($seed . ':support');
        $cfg = $this->config['incumbency'];

        // One swing per party per game, applied to every seat — see the note in
        // campaign-config.json. Without it the real membership would replay
        // itself and the largest incumbent bloc would start past the majority.
        $swing = [];
        foreach ($partyIds as $id) {
            // Others never gets a statewide swing — small parties and
            // independents hold seats one at a time, they do not surge.
            $swing[$id] = $id === 'oth'
                ? (float) $cfg['othersHandicap']
                : ($rand() - 0.5) * (float) $cfg['partySwingSpread'];
        }

        $support = [];
        $incumbency = [];

        foreach ($constituencies as $number) {
            $key = (string) $number;
            $holder = self::gamePartyFor($incumbents[$key] ?? null, $partyIds);
            $level = self::weightedPick($cfg['levels'], $rand());

            $seat = [];
            foreach ($partyIds as $id) {
                $seat[$id] = max(2.0, $cfg['baseSupport'] + $swing[$id] + ($rand() - 0.5) * $cfg['spread']);
            }
            $seat[$holder] += (float) $level['advantage'];

            $support[$key] = self::normalise($seat);
            $incumbency[$key] = [
                'party' => $holder,
                'level' => $level['id'],
                'label' => $level['label'],
            ];
        }
        return [$support, $incumbency];
    }

    /** Real party code -> game party. Anything unplayable becomes "oth". */
    public static function gamePartyFor(?string $realCode, array $playable): string
    {
        $id = strtolower((string) $realCode);
        return in_array($id, $playable, true) ? $id : 'oth';
    }

    public static function normalise(array $seat): array
    {
        $total = 0.0;
        foreach ($seat as $id => $v) {
            $seat[$id] = max(0.5, (float) $v);
            $total += $seat[$id];
        }
        if ($total <= 0) {
            return $seat;
        }
        foreach ($seat as $id => $v) {
            $seat[$id] = round(($v / $total) * 1000) / 10;
        }
        return $seat;
    }

    /** Sorted [partyId => support] descending. */
    public static function standings(array $seat): array
    {
        arsort($seat);
        return $seat;
    }

    /* ------------------------------------------------------------ playing */

    /* ------------------------------------------------------------- money */

    /**
     * Spendable general cash. Borrowed money is in here; what is owed is not
     * deducted until it falls due, which is exactly what makes borrowing
     * tempting. Grant money is deliberately not counted — see spendableOn.
     */
    public function remaining(array $player): int
    {
        return max(0, (int) ($player['cash'] ?? 0));
    }

    /* ------------------------------------------------- region purses */

    public function territory(): Territory
    {
        if ($this->territory === null) {
            $this->territory = new Territory();
        }
        return $this->territory;
    }

    public function grantIn(array $player, ?string $region): int
    {
        if ($region === null) {
            return 0;
        }
        return max(0, (int) (($player['grants'] ?? [])[$region] ?? 0));
    }

    /** Every region purse added up. Spendable, but not spendable anywhere. */
    public function grantTotal(array $player): int
    {
        $total = 0;
        foreach (($player['grants'] ?? []) as $amount) {
            $total += max(0, (int) $amount);
        }
        return $total;
    }

    /**
     * What can go behind a move aimed at one seat: general cash, plus the
     * purse for that seat's region and nothing else.
     *
     * A move with no seat behind it can only draw general cash, because there
     * is no region in which to say the grant money was spent.
     *
     * @return array{region:?string,cash:int,grant:int,total:int}
     */
    public function spendableOn(array $player, $target): array
    {
        $region = ($target === null || $target === '')
            ? null
            : $this->territory()->regionOfSeat($target);
        $grant = $this->grantIn($player, $region);
        $cash = $this->remaining($player);
        return ['region' => $region, 'cash' => $cash, 'grant' => $grant, 'total' => $cash + $grant];
    }

    /**
     * Take money off a player, region purse first.
     *
     * The restricted money goes before the free money: holding it back would
     * strand it the moment the district that earned it was lost.
     *
     * @return array{0:array,1:array{total:int,grant:int,cash:int,region:?string}}
     */
    public function charge(array $player, $target, int $amount): array
    {
        $pot = $this->spendableOn($player, $target);
        $take = max(0, min($amount, $pot['total']));

        $fromGrant = min($pot['grant'], $take);
        $fromCash = $take - $fromGrant;

        if ($fromGrant > 0) {
            $grants = $player['grants'] ?? [];
            $grants[$pot['region']] = $this->grantIn($player, $pot['region']) - $fromGrant;
            $player['grants'] = $grants;
        }
        $player['cash'] = max(0, (int) $player['cash'] - $fromCash);

        return [$player, [
            'total' => $take,
            'grant' => $fromGrant,
            'cash' => $fromCash,
            'region' => $pot['region'],
        ]];
    }

    /* ------------------------------------------------------ the ledger */

    /**
     * Write one movement of money into the player's own account of it.
     *
     * The running balances are the truth; this is the record of how they got
     * there, written by the same code that moves the money so the two cannot
     * tell different stories.
     */
    public function ledger(array $player, array $entry): array
    {
        $entry['round'] = (int) ($entry['round'] ?? ($player['round'] ?? 1));
        $entry['at'] = time();
        $rows = $player['ledger'] ?? [];
        $rows[] = $entry;
        if (count($rows) > 400) {
            array_shift($rows);
        }
        $player['ledger'] = $rows;
        return $player;
    }

    /**
     * Credit one round's allowance, once.
     *
     * Keyed by round rather than counted, so a refresh, a reconnection, a
     * retried request or a doubled-up advance cannot pay anybody twice. That
     * is the one accounting failure this economy would never recover from.
     */
    public function creditRoundIncome(array $player, int $round): array
    {
        $credited = $player['incomeCredited'] ?? [];
        $key = (string) $round;
        if (!empty($credited[$key])) {
            return $player;
        }

        $amount = (int) (($this->config['income'] ?? [])['perRound'] ?? 0);
        $credited[$key] = true;
        $player['incomeCredited'] = $credited;
        $player['cash'] = (int) ($player['cash'] ?? 0) + $amount;
        $player['incomeTotal'] = (int) ($player['incomeTotal'] ?? 0) + $amount;

        return $this->ledger($player, [
            'round' => $round,
            'kind' => 'income',
            'label' => 'Round allowance',
            'amount' => $amount,
        ]);
    }

    /**
     * Pay the grants for every district this player wholly holds, once for
     * the round, into the purse for each district's own region.
     */
    public function creditDistrictGrants(array $player, array $board, int $round): array
    {
        $credited = $player['grantsCredited'] ?? [];
        $key = (string) $round;
        if (!empty($credited[$key])) {
            return $player;
        }
        $credited[$key] = true;
        $player['grantsCredited'] = $credited;

        $partyId = (string) ($player['partyId'] ?? '');
        if ($partyId === '') {
            return $player;
        }

        $held = $this->territory()->heldBy(Territory::leadersOf($board), $partyId);
        $player['districtsHeld'] = count($held);

        // A grant is for a district taken, not one inherited. The opening
        // board is dealt from the sitting MLAs and routinely hands one party
        // several districts before anybody has campaigned; paying for those
        // would settle the election on the deal. They pay nothing until they
        // are lost and taken back, which is a thing the player did.
        $opening = $player['openingDistricts'] ?? [];
        $earned = [];
        foreach ($held as $d) {
            if (!in_array($d['id'], $opening, true)) {
                $earned[] = $d;
            }
        }

        $grants = $player['grants'] ?? [];
        $total = 0;

        foreach ($earned as $d) {
            $region = (string) $d['region'];
            $grants[$region] = max(0, (int) ($grants[$region] ?? 0)) + (int) $d['grant'];
            $total += (int) $d['grant'];
            $player = $this->ledger($player, [
                'round' => $round,
                'kind' => 'grant',
                'label' => $d['name'] . ' district grant',
                'region' => $region,
                'district' => $d['id'],
                'amount' => (int) $d['grant'],
            ]);
        }

        $player['grants'] = $grants;
        $player['grantTotalEarned'] = (int) ($player['grantTotalEarned'] ?? 0) + $total;
        $player['districtsPaying'] = count($earned);
        return $player;
    }

    /** Everything still owed to the banks, principal and interest together. */
    public function debtOf(array $player): int
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
     * What a loan of this size would cost and when the bill lands, or a
     * refusal. Quoting and taking share this so the confirmation screen can
     * never show terms the server would then decline.
     */
    /**
     * What a campaign can actually pay back.
     *
     * Cash it holds, plus the round allowances certain to arrive before the
     * bill falls due, plus the grants its current districts already pay —
     * less everything already owed.
     *
     * Nothing speculative counts. Not seats, which are not money. Not
     * campaign winnings, which may never arrive. Not grants from districts it
     * has not taken. A lender who counts hopes as income is not lending.
     *
     * @return array{cash:int,income:int,grants:int,owed:int,total:int,dueRound:int}
     */
    public function repaymentCapacity(array $player, array $board, int $round): array
    {
        $cfg = $this->finance()['loan'];
        $rounds = $this->rounds();
        $due = min((int) $rounds['total'], $round + (int) $cfg['repayAfterRounds']);
        $toCome = max(0, $due - $round);

        $income = $toCome * (int) (($this->config['income'] ?? [])['perRound'] ?? 0);

        $partyId = (string) ($player['partyId'] ?? '');
        $perRound = 0;
        if ($partyId !== '') {
            $opening = $player['openingDistricts'] ?? [];
            foreach ($this->territory()->heldBy(Territory::leadersOf($board), $partyId) as $d) {
                if (!in_array($d['id'], $opening, true)) {
                    $perRound += (int) $d['grant'];
                }
            }
        }
        $grants = $toCome * $perRound;

        $cash = $this->remaining($player);
        $owed = $this->debtOf($player);

        return [
            'cash' => $cash,
            'income' => $income,
            'grants' => $grants,
            'owed' => $owed,
            'total' => max(0, $cash + $income + $grants - $owed),
            'dueRound' => $due,
        ];
    }

    /** The largest loan this campaign could service, to the increment. */
    public function maxLoan(array $player, array $board, int $round): int
    {
        $cfg = $this->finance()['loan'];
        $capacity = $this->repaymentCapacity($player, $board, $round)['total'];
        $affordable = (int) floor($capacity / (1 + (float) $cfg['interestRate']));
        $capped = min(
            $affordable,
            (int) $cfg['maxAmount'],
            (int) $cfg['debtLimit'] - $this->debtOf($player)
        );
        $step = (int) $cfg['increments'];
        return max(0, (int) (floor($capped / $step) * $step));
    }

    public function loanOffer(array $player, int $amount, int $round, array $board = []): array
    {
        $cfg = $this->finance()['loan'];
        $step = (int) $cfg['increments'];
        $amount = (int) (round($amount / $step) * $step);

        $capacity = $this->repaymentCapacity($player, $board, $round);
        $most = $this->maxLoan($player, $board, $round);

        $offer = [
            'capacity' => $capacity,
            'maxAffordable' => $most,
            'amount' => $amount,
            'interestRate' => (float) $cfg['interestRate'],
            'interest' => (int) round($amount * (float) $cfg['interestRate']),
            'repay' => $amount + (int) round($amount * (float) $cfg['interestRate']),
            'dueRound' => $round + (int) $cfg['repayAfterRounds'],
            'debtNow' => $this->debtOf($player),
            'debtLimit' => (int) $cfg['debtLimit'],
            'ok' => true,
            'error' => null,
        ];

        $refuse = function (string $why) use ($offer): array {
            $offer['ok'] = false;
            $offer['error'] = $why;
            return $offer;
        };

        if (!empty($player['record']['disqualified'])) {
            return $refuse('You are out of this election.');
        }
        if (!empty($player['borrowingBlocked'])) {
            return $refuse('No bank will lend to you after your default.');
        }

        // Nobody lends to a campaign already behind on one. The balance has to
        // be cleared before there is any question of another.
        foreach (($player['loans'] ?? []) as $l) {
            if (empty($l['settled']) && !empty($l['missedCount'])) {
                return $refuse('Clear your missed payment before borrowing again.');
            }
        }
        if ($amount < (int) $cfg['minAmount']) {
            return $refuse('The smallest loan is ' . self::money((int) $cfg['minAmount']) . '.');
        }
        if ($amount > (int) $cfg['maxAmount']) {
            return $refuse('The largest single loan is ' . self::money((int) $cfg['maxAmount']) . '.');
        }
        if ($round > (int) $cfg['noBorrowingAfterRound']) {
            // Otherwise the last rounds would offer free money, because the
            // bill would fall due after the campaign had already closed.
            return $refuse('Too late to borrow — repayment would fall after election day.');
        }
        if ($offer['debtNow'] + $offer['repay'] > (int) $cfg['debtLimit']) {
            return $refuse('That would take you past your debt limit of '
                . self::money((int) $cfg['debtLimit']) . '.');
        }

        // The affordability rule. Nobody is lent money they have no way to
        // repay, which also closes the obvious exploit: borrow far more than
        // you can service, spend it, and let the default be somebody else's
        // problem.
        if ($amount > $most) {
            return $refuse(
                $most > 0
                    ? 'Your projected repayment capacity does not support this loan. '
                        . 'The most you can borrow is ' . self::money($most) . '.'
                    : 'Your current repayment capacity is too low for a loan.'
            );
        }

        return $offer;
    }

    /** Take a loan on the quoted terms. Returns [player, offer]. */
    public function takeLoan(array $player, int $amount, int $round, array $board = []): array
    {
        $offer = $this->loanOffer($player, $amount, $round, $board);
        if (!$offer['ok']) {
            return [$player, $offer];
        }

        $player['cash'] = (int) $player['cash'] + $offer['amount'];
        $player = $this->ledger($player, [
            'kind' => 'loan',
            'label' => 'Loan taken',
            'amount' => (int) $offer['amount'],
        ]);
        $player['borrowed'] = (int) ($player['borrowed'] ?? 0) + $offer['amount'];
        $player['loans'][] = [
            'id' => 'L' . (count($player['loans'] ?? []) + 1),
            'amount' => $offer['amount'],
            'interest' => $offer['interest'],
            'repay' => $offer['repay'],
            'takenRound' => $round,
            'dueRound' => $offer['dueRound'],
            'settled' => false,
            'defaulted' => false,
        ];
        return [$player, $offer];
    }

    /**
     * Loans falling due this round. A player who cannot cover one pays what
     * they can and defaults on the rest.
     *
     * Default is deliberately more painful than the money involved: heat, a
     * restriction, lost support and no further credit. Without that, the
     * optimal play would be to borrow the maximum every round and simply never
     * repay, which would make the whole mechanic free.
     */
    /**
     * Loans first, before anything else in the round.
     *
     * A campaign pays what it owes out of what it has, and only what is left
     * can be spent. The other order would let anybody borrow, spend the lot,
     * and arrive at the due round with nothing — not a strategy, a bug with a
     * plan.
     *
     * A payment that cannot be met is not a default and does not clear the
     * debt. What there is goes toward it, the balance carries into the next
     * round, and the outstanding amount takes a penalty. It keeps carrying,
     * and keeps taking the penalty, until it is cleared.
     */
    public function settleLoans(array $player, int $round, array $summary): array
    {
        $cfgDefault = $this->finance()['default'];
        $rate = (float) ($this->finance()['loan']['missedPenaltyRate'] ?? 0.3);

        foreach (($player['loans'] ?? []) as $i => $loan) {
            if (!empty($loan['settled']) || (int) $loan['dueRound'] > $round) {
                continue;
            }

            $outstanding = max(0, (int) $loan['repay'] - (int) ($loan['paid'] ?? 0));
            if ($outstanding <= 0) {
                $player['loans'][$i]['settled'] = true;
                continue;
            }

            $pay = min((int) $player['cash'], $outstanding);
            if ($pay > 0) {
                $player['cash'] = (int) $player['cash'] - $pay;
                $player['repaid'] = (int) ($player['repaid'] ?? 0) + $pay;
                $player['loans'][$i]['paid'] = (int) ($loan['paid'] ?? 0) + $pay;
                $player = $this->ledger($player, [
                    'round' => $round,
                    'kind' => 'repayment',
                    'label' => 'Loan repayment',
                    'amount' => -$pay,
                ]);
            }

            $left = $outstanding - $pay;

            if ($left <= 0) {
                $player['loans'][$i]['settled'] = true;
                $player['interestPaid'] = (int) ($player['interestPaid'] ?? 0)
                    + (int) $loan['interest'];
                $summary['repayments'][] = [
                    'id' => $loan['id'],
                    'paid' => $pay,
                    'interest' => (int) $loan['interest'],
                    'defaulted' => false,
                    'text' => !empty($loan['missedCount'])
                        ? 'Loan cleared, with penalties.'
                        : 'Loan repaid with interest.',
                ];
                continue;
            }

            $penalty = (int) round($left * $rate);
            $player['loans'][$i]['repay'] = (int) ($player['loans'][$i]['paid'] ?? 0)
                + $left + $penalty;
            $player['loans'][$i]['penalties'] = (int) ($loan['penalties'] ?? 0) + $penalty;
            $player['loans'][$i]['missedCount'] = (int) ($loan['missedCount'] ?? 0) + 1;
            $player['loans'][$i]['dueRound'] = $round + 1;

            $player['missedPayments'] = (int) ($player['missedPayments'] ?? 0) + 1;
            $player['heat'] = self::clamp(
                (float) $player['heat'] + (float) $cfgDefault['heat'] / 2,
                0,
                (float) $this->config['heat']['max']
            );

            $player = $this->ledger($player, [
                'round' => $round,
                'kind' => 'penalty',
                'label' => 'Missed payment penalty',
                'amount' => -$penalty,
            ]);

            $summary['repayments'][] = [
                'id' => $loan['id'],
                'paid' => $pay,
                'shortfall' => $left,
                'penalty' => $penalty,
                'outstanding' => $left + $penalty,
                'missed' => true,
                'dueRound' => $round + 1,
                'text' => 'Payment missed. ' . round($rate * 100) . '% added; '
                    . 'the balance is due again next round.',
            ];
            $summary['missedPayment'] = true;
        }

        return [$player, $summary];
    }

    /** Heat cools between rounds, never below zero. */
    public function coolHeat(float $heat): float
    {
        $cool = (float) ($this->config['heat']['coolPerRound'] ?? 0);
        return self::clamp($heat - $cool, 0, (float) $this->config['heat']['max']);
    }

    public static function money(int $paise): string
    {
        if ($paise >= 10000000) {
            return '₹' . rtrim(rtrim(number_format($paise / 10000000, 2, '.', ''), '0'), '.') . ' crore';
        }
        if ($paise >= 100000) {
            return '₹' . rtrim(rtrim(number_format($paise / 100000, 2, '.', ''), '0'), '.') . ' lakh';
        }
        return '₹' . number_format($paise);
    }

    /* ------------------------------------------------------------ playing */

    /** How many more moves this player has left in the current round. */
    public function actionsLeft(array $player): int
    {
        $cap = (int) ($this->rounds()['actionsPerRound'] ?? 0);
        if ($cap <= 0) {
            return PHP_INT_MAX;
        }
        return max(0, $cap - (int) ($player['roundActions'] ?? 0));
    }

    /** Why this action cannot be played, or null if it can. */
    public function blockedReason(array $player, array $board, string $actionId, $target, $amount = null): ?string
    {
        $action = $this->action($actionId);
        if ($action === null) {
            return 'Unknown action.';
        }
        if (!empty($player['roundReady'])) {
            return 'You have ended your round. Wait for the next one.';
        }
        if ($this->actionsLeft($player) <= 0) {
            return 'No moves left this round';
        }
        $spend = $this->resolveAmount($action, $amount);
        if ($spend > $this->spendableOn($player, $target)['total']) {
            return 'More than you can spend here';
        }
        if (!empty($action['needsConstituency'])) {
            if ($target === null || $target === '') {
                return 'Choose a constituency first';
            }
            if (!isset($board[(string) $target])) {
                return 'Unknown constituency';
            }
        }
        return null;
    }

    /**
     * Resolve one action against the shared board. $rolls supplies the
     * randomness so the caller controls the RNG. Returns [player, board,
     * report].
     *
     * The board is shared and the money is not: an action moves support that
     * every player can see, and spends only the player's own cash.
     */
    public function play(array $player, array $board, string $actionId, $target, array $rolls, $amount = null): array
    {
        $action = $this->action($actionId);
        $outcome = self::weightedPick($action['outcomes'], $rolls['outcome']);
        $key = $target === null ? null : (string) $target;

        // What the player chose to put behind it, and what that buys.
        $cost = $this->resolveAmount($action, $amount);
        $scale = $this->scaleFor($action, $cost);
        $outcome = self::scaleOutcome($outcome, $scale);
        // Region purse first, then general cash.
        [$player, $paid] = $this->charge($player, $target, $cost);
        $cost = $paid['total'];
        $player['spent'] = (int) $player['spent'] + $cost;
        $player['roundSpent'] = (int) ($player['roundSpent'] ?? 0) + $cost;
        $player['roundActions'] = (int) ($player['roundActions'] ?? 0) + 1;
        $player = $this->ledger($player, [
            'kind' => 'campaign',
            'label' => (string) ($action['label'] ?? $actionId),
            'seat' => $target === null ? null : (int) $target,
            'region' => $paid['region'],
            'fromGrant' => $paid['grant'],
            'fromCash' => $paid['cash'],
            'amount' => -$cost,
        ]);

        // Money an outcome brings in. Grants are recorded apart from
        // undisclosed funding so a player's own breakdown stays honest about
        // where the campaign's money came from.
        $funds = (int) ($outcome['funds'] ?? 0);
        if ($funds > 0) {
            $player['cash'] = (int) $player['cash'] + $funds;
            $player['roundGained'] = (int) ($player['roundGained'] ?? 0) + $funds;
            if (($action['id'] ?? '') === 'grant') {
                $player['granted'] = (int) ($player['granted'] ?? 0) + $funds;
            } else {
                $player['raised'] = (int) ($player['raised'] ?? 0) + $funds;
            }
            $player = $this->ledger($player, [
                'kind' => ($action['id'] ?? '') === 'grant' ? 'funding' : 'raised',
                'label' => (string) ($action['label'] ?? $actionId),
                'amount' => $funds,
            ]);
        }

        $applied = ['player' => 0.0, 'opponent' => 0.0, 'reach' => []];
        if ($key !== null && isset($board[$key])) {
            $seat = $board[$key];

            if (!empty($outcome['support'])) {
                $before = $seat[$player['partyId']] ?? 0;
                $seat[$player['partyId']] = self::clamp($before + (float) $outcome['support'], 1, 95);
                $applied['player'] = $seat[$player['partyId']] - $before;
            }
            if (!empty($outcome['opponentSupport'])) {
                $ranked = self::standings($seat);
                foreach ($ranked as $pid => $val) {
                    if ($pid !== $player['partyId']) {
                        $before = $val;
                        $seat[$pid] = self::clamp($before + (float) $outcome['opponentSupport'], 1, 95);
                        $applied['opponent'] = $seat[$pid] - $before;
                        break;
                    }
                }
            }
            $board[$key] = self::normalise($seat);

            // Dearer actions are seen beyond the seat they are aimed at. The
            // spill is a fraction of whatever actually happened, so a costly
            // campaign that goes wrong goes wrong across several seats too.
            if (!empty($action['reach']) && !empty($outcome['support'])) {
                $reach = $action['reach'];
                // More money is seen in more places.
                $extra = (int) round(((int) $reach['seats']) * $scale) - 1;
                if ($extra > 0) {
                    [$board, $spilled] = $this->applyAcross(
                        $board,
                        (string) $player['partyId'],
                        (float) $outcome['support'] * (float) $reach['share'],
                        $extra,
                        $player,
                        $key
                    );
                    $applied['reach'] = $spilled;
                }
            }
        }

        // An outcome with no constituency of its own — undisclosed funding
        // going wrong, say — still costs support, spread over the seats the
        // player is doing best in.
        if ($key === null && !empty($outcome['support'])) {
            [$board, ] = $this->applyAcross(
                $board,
                (string) $player['partyId'],
                (float) $outcome['support'],
                (int) ($outcome['seats'] ?? 1),
                $player
            );
        }

        $heatBefore = (float) $player['heat'];
        $max = (float) $this->config['heat']['max'];
        $player['heat'] = self::clamp($heatBefore + (float) ($outcome['heat'] ?? 0), 0, $max);

        [$player, $board, $consequence] = $this->maybeConsequence($player, $board, $rolls);

        $report = [
            'actionId' => $action['id'],
            'label' => $action['label'],
            'group' => $action['group'],
            'constituency' => $key === null ? null : (int) $key,
            'cost' => $cost,
            'baseCost' => (int) $action['cost'],
            'scale' => round($scale, 2),
            'funds' => $funds,
            'outcomeId' => $outcome['id'],
            'outcomeLabel' => $outcome['label'],
            'text' => $outcome['text'],
            'support' => round($applied['player'], 1),
            'opponentSupport' => round($applied['opponent'], 1),
            'reach' => $applied['reach'],
            'heatBefore' => $heatBefore,
            'heatAfter' => $player['heat'],
            'cashAfter' => (int) $player['cash'],
            'consequence' => $consequence,
            'round' => (int) ($player['round'] ?? 0),
        ];

        $player['actions'][] = $report;
        if (count($player['actions']) > 60) {
            array_shift($player['actions']);
        }

        return [$player, $board, $report];
    }

    /**
     * Spread a support change over the seats this player cares about most —
     * the ones they have campaigned in, then the ones they are strongest in.
     * Returns [board, seats hit].
     */
    private function applyAcross(
        array $board,
        string $partyId,
        float $delta,
        int $count,
        array $player,
        ?string $except = null
    ): array {
        $touched = [];
        foreach (($player['actions'] ?? []) as $a) {
            if (!empty($a['constituency'])) {
                $k = (string) $a['constituency'];
                $touched[$k] = ($touched[$k] ?? 0) + 1;
            }
        }
        $numbers = array_map('strval', array_keys($board));
        if ($except !== null) {
            $numbers = array_values(array_filter($numbers, static fn($n) => $n !== $except));
        }
        usort($numbers, static function ($a, $b) use ($touched, $board, $partyId) {
            $diff = ($touched[$b] ?? 0) <=> ($touched[$a] ?? 0);
            if ($diff !== 0) {
                return $diff;
            }
            return ($board[$b][$partyId] ?? 0) <=> ($board[$a][$partyId] ?? 0);
        });

        $hit = [];
        $count = min(max(1, $count), count($numbers));
        for ($i = 0; $i < $count; $i++) {
            $k = $numbers[$i];
            $seat = $board[$k];
            $seat[$partyId] = self::clamp(($seat[$partyId] ?? 0) + $delta, 1, 95);
            $board[$k] = self::normalise($seat);
            $hit[] = (int) $k;
        }
        return [$board, $hit];
    }

    /**
     * Heat raises the odds of trouble rather than scheduling it. Below the
     * configured floor nothing fires; above it the chance climbs with heat.
     */
    private function maybeConsequence(array $player, array $board, array $rolls): array
    {
        $cfg = $this->config['heat'];
        if ((float) $player['heat'] < (float) $cfg['minHeat']) {
            return [$player, $board, null];
        }

        $chance = ((float) $player['heat'] / (float) $cfg['max']) * (float) $cfg['chanceFactor'];
        if ((float) $rolls['consequence'] >= $chance) {
            return [$player, $board, null];
        }

        $eligible = array_values(array_filter(
            $this->config['consequences'],
            static fn($c) => (float) $player['heat'] >= (float) $c['minHeat']
        ));
        if (!$eligible) {
            return [$player, $board, null];
        }

        $pick = self::weightedPick($eligible, $rolls['consequencePick']);
        [$board, $hit] = $this->applyAcross(
            $board,
            (string) $player['partyId'],
            (float) $pick['support'],
            (int) ($pick['seats'] ?? 1),
            $player
        );

        $player['heat'] = self::clamp(
            (float) $player['heat'] + (float) ($pick['heat'] ?? 0),
            0,
            (float) $cfg['max']
        );

        return [$player, $board, [
            'id' => $pick['id'],
            'label' => $pick['label'],
            'text' => $pick['text'],
            'seats' => $hit,
            'support' => (float) $pick['support'],
        ]];
    }

    /* ------------------------------------------------------------- events */

    /**
     * At most one event per player per round, and most rounds none — an event
     * every round would drown out the decisions players actually made.
     * Returns [player, board, event|null].
     */
    public function rollEvent(array $player, array $board, callable $rand): array
    {
        $cfg = $this->config['events'];
        if ($rand() >= (float) $cfg['chancePerRound']) {
            return [$player, $board, null];
        }

        $pick = self::weightedPick($cfg['list'], $rand());
        $partyId = (string) $player['partyId'];
        $hit = [];

        if (!empty($pick['support'])) {
            [$board, $hit] = $this->applyAcross(
                $board,
                $partyId,
                (float) $pick['support'],
                (int) ($pick['seats'] ?? 1),
                $player
            );
        }
        if (!empty($pick['funds'])) {
            $player['cash'] = (int) $player['cash'] + (int) $pick['funds'];
            $player['granted'] = (int) ($player['granted'] ?? 0) + (int) $pick['funds'];
            $player['roundGained'] = (int) ($player['roundGained'] ?? 0) + (int) $pick['funds'];
        }
        if (!empty($pick['heat'])) {
            $player['heat'] = self::clamp(
                (float) $player['heat'] + (float) $pick['heat'],
                0,
                (float) $this->config['heat']['max']
            );
        }

        return [$player, $board, [
            'id' => $pick['id'],
            'kind' => $pick['kind'],
            'label' => $pick['label'],
            'text' => $pick['text'],
            'support' => (float) ($pick['support'] ?? 0),
            'funds' => (int) ($pick['funds'] ?? 0),
            'heat' => (float) ($pick['heat'] ?? 0),
            'seats' => $hit,
        ]];
    }

    /* ------------------------------------------------------------ counting */

    /** Which party leads a seat. */
    public static function leaderOf(array $seat): ?string
    {
        $best = null;
        $bestId = null;
        foreach ($seat as $pid => $v) {
            if ($best === null || $v > $best) {
                $best = $v;
                $bestId = $pid;
            }
        }
        return $bestId;
    }

    /** Seats currently led, per party. Every party gets a key, including zero. */
    public function seatCounts(array $board): array
    {
        $counts = [];
        foreach (Lobby::GAME_PARTIES as $id) {
            $counts[$id] = 0;
        }
        foreach ($board as $seat) {
            $leader = self::leaderOf($seat);
            if ($leader !== null) {
                $counts[$leader] = ($counts[$leader] ?? 0) + 1;
            }
        }
        return $counts;
    }

    /** Mean support across the whole board, for one party. */
    public function averageSupport(array $board, string $partyId): float
    {
        if (!$board) {
            return 0.0;
        }
        $total = 0.0;
        foreach ($board as $seat) {
            $total += (float) ($seat[$partyId] ?? 0);
        }
        return round($total / count($board), 1);
    }

    /** How many seats a party currently leads. */
    public function seatsLed(array $board, string $partyId): int
    {
        $count = 0;
        foreach ($board as $seat) {
            if (self::leaderOf($seat) === $partyId) {
                $count++;
            }
        }
        return $count;
    }

    /* ------------------------------------------------------------ rng */

    /** mulberry32, matching js/engine/rng.js exactly. */
    public static function seededSequence(string $seed): callable
    {
        $a = self::hashString($seed);
        return function () use (&$a) {
            $a = ($a + 0x6d2b79f5) & 0xffffffff;
            $t = $a;
            $t = self::imul($t ^ ($t >> 15), $t | 1);
            $t ^= ($t + self::imul($t ^ ($t >> 7), $t | 61)) & 0xffffffff;
            return (($t ^ ($t >> 14)) & 0xffffffff) / 4294967296;
        };
    }

    public static function hashString(string $str): int
    {
        $h = 2166136261;
        $len = strlen($str);
        for ($i = 0; $i < $len; $i++) {
            $h ^= ord($str[$i]);
            $h = self::imul($h, 16777619);
        }
        return $h & 0xffffffff;
    }

    /** 32-bit multiply with wraparound, like JavaScript's Math.imul. */
    public static function imul(int $a, int $b): int
    {
        $a &= 0xffffffff;
        $b &= 0xffffffff;
        $aHi = ($a >> 16) & 0xffff;
        $aLo = $a & 0xffff;
        $bHi = ($b >> 16) & 0xffff;
        $bLo = $b & 0xffff;
        return ((($aLo * $bLo) + (((($aHi * $bLo) + ($aLo * $bHi)) << 16))) & 0xffffffff);
    }

    /** The rolls one action needs, advancing the player's own stream. */
    public static function rollsFor(string $seed, int $rollCount): array
    {
        $next = self::seededSequence($seed . ':' . $rollCount);
        return [
            'outcome' => $next(),
            'consequence' => $next(),
            'consequencePick' => $next(),
            'spare' => $next(),
        ];
    }
}
