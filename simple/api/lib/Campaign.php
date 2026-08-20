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

    public function action(string $id): ?array
    {
        foreach ($this->config['actions'] as $a) {
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

    public function remaining(array $player): int
    {
        return max(0, (int) $player['budget'] - (int) $player['spent']);
    }

    /** Why this action cannot be played, or null if it can. */
    public function blockedReason(array $player, string $actionId, $target): ?string
    {
        $action = $this->action($actionId);
        if ($action === null) {
            return 'Unknown action.';
        }
        if ((int) $action['cost'] > $this->remaining($player)) {
            return 'Insufficient Budget';
        }
        if (!empty($action['needsConstituency'])) {
            if ($target === null || $target === '') {
                return 'Choose a constituency first';
            }
            if (!isset($player['support'][(string) $target])) {
                return 'Unknown constituency';
            }
        }
        return null;
    }

    /**
     * Resolve one action against one player's own state. $rolls supplies the
     * randomness so the caller controls the RNG. Returns [player, report].
     */
    public function play(array $player, string $actionId, $target, array $rolls): array
    {
        $action = $this->action($actionId);
        $outcome = self::weightedPick($action['outcomes'], $rolls['outcome']);
        $key = $target === null ? null : (string) $target;

        $player['spent'] = (int) $player['spent'] + (int) $action['cost'];

        $applied = ['player' => 0.0, 'opponent' => 0.0];
        if ($key !== null && isset($player['support'][$key])) {
            $seat = $player['support'][$key];

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
            $player['support'][$key] = self::normalise($seat);
        }

        $heatBefore = (float) $player['heat'];
        $max = (float) $this->config['heat']['max'];
        $player['heat'] = self::clamp($heatBefore + (float) ($outcome['heat'] ?? 0), 0, $max);

        [$player, $consequence] = $this->maybeConsequence($player, $rolls);

        $report = [
            'actionId' => $action['id'],
            'label' => $action['label'],
            'group' => $action['group'],
            'constituency' => $key === null ? null : (int) $key,
            'cost' => (int) $action['cost'],
            'outcomeId' => $outcome['id'],
            'outcomeLabel' => $outcome['label'],
            'text' => $outcome['text'],
            'support' => round($applied['player'], 1),
            'opponentSupport' => round($applied['opponent'], 1),
            'heatBefore' => $heatBefore,
            'heatAfter' => $player['heat'],
            'consequence' => $consequence,
        ];

        $player['actions'][] = $report;
        if (count($player['actions']) > 60) {
            array_shift($player['actions']);
        }

        return [$player, $report];
    }

    /**
     * Heat raises the odds of trouble rather than scheduling it. Below the
     * configured floor nothing fires; above it the chance climbs with heat.
     */
    private function maybeConsequence(array $player, array $rolls): array
    {
        $cfg = $this->config['heat'];
        if ((float) $player['heat'] < (float) $cfg['minHeat']) {
            return [$player, null];
        }

        $chance = ((float) $player['heat'] / (float) $cfg['max']) * (float) $cfg['chanceFactor'];
        if ((float) $rolls['consequence'] >= $chance) {
            return [$player, null];
        }

        $eligible = array_values(array_filter(
            $this->config['consequences'],
            static fn($c) => (float) $player['heat'] >= (float) $c['minHeat']
        ));
        if (!$eligible) {
            return [$player, null];
        }

        $pick = self::weightedPick($eligible, $rolls['consequencePick']);

        // Hit where the player has actually been campaigning.
        $touched = [];
        foreach ($player['actions'] as $a) {
            if (!empty($a['constituency'])) {
                $k = (string) $a['constituency'];
                $touched[$k] = ($touched[$k] ?? 0) + 1;
            }
        }
        $numbers = array_keys($player['support']);
        usort($numbers, function ($a, $b) use ($touched, $player) {
            $a = (string) $a;
            $b = (string) $b;
            $diff = ($touched[$b] ?? 0) <=> ($touched[$a] ?? 0);
            if ($diff !== 0) {
                return $diff;
            }
            return ($player['support'][$b][$player['partyId']] ?? 0)
                <=> ($player['support'][$a][$player['partyId']] ?? 0);
        });

        $hit = [];
        $count = min((int) ($pick['seats'] ?? 1), count($numbers));
        for ($i = 0; $i < $count; $i++) {
            $k = (string) $numbers[$i];
            $seat = $player['support'][$k];
            $before = $seat[$player['partyId']] ?? 0;
            $seat[$player['partyId']] = self::clamp($before + (float) $pick['support'], 1, 95);
            $player['support'][$k] = self::normalise($seat);
            $hit[] = (int) $k;
        }

        $player['heat'] = self::clamp(
            (float) $player['heat'] + (float) ($pick['heat'] ?? 0),
            0,
            (float) $cfg['max']
        );

        return [$player, [
            'id' => $pick['id'],
            'label' => $pick['label'],
            'text' => $pick['text'],
            'seats' => $hit,
            'support' => (float) $pick['support'],
        ]];
    }

    /** How many seats this player currently leads. */
    public function seatsLed(array $player): int
    {
        $count = 0;
        foreach ($player['support'] as $seat) {
            $best = null;
            $bestId = null;
            foreach ($seat as $pid => $v) {
                if ($best === null || $v > $best) {
                    $best = $v;
                    $bestId = $pid;
                }
            }
            if ($bestId === $player['partyId']) {
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
