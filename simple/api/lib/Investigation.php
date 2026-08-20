<?php
/**
 * Reports, investigations and penalties.
 * ------------------------------------------------------------------
 * A fictional oversight mechanic sitting on top of Political Heat.
 *
 * The design point that matters: a report is an accusation, not a verdict.
 * Outcomes are rolled against a hidden evidence score, so three players
 * ganging up on an innocent rival will often see them CLEARED — and a player
 * who has actually been running hot can be fined on two reports. That keeps
 * reporting a judgement call rather than a way to delete an opponent.
 *
 * Each player may report each rival once. Repeat reports are ignored rather
 * than counted, so the threshold cannot be inflated by one person.
 */
declare(strict_types=1);

final class Investigation
{
    private array $config;
    private Campaign $campaign;

    public function __construct(Campaign $campaign)
    {
        $this->campaign = $campaign;
        $this->config = $campaign->config()['investigation'];
    }

    public function config(): array
    {
        return $this->config;
    }

    public function reasonIsValid(string $id): bool
    {
        foreach ($this->config['reasons'] as $r) {
            if ($r['id'] === $id) {
                return true;
            }
        }
        return false;
    }

    /** A fresh, empty record for a player. */
    public static function newRecord(): array
    {
        return [
            'reportsAgainst' => [],   // reporterId => ['reason' => ..., 'at' => ...]
            'reportsMade' => [],      // accusedId => true
            'penalties' => [],        // history of findings that counted against them
            'investigations' => [],   // every completed investigation
            'restrictedUntilTurn' => 0,
            'disqualified' => false,
        ];
    }

    /**
     * Record one report. Returns [game, result] where result explains what
     * happened: a duplicate is refused, and reaching the threshold opens an
     * investigation.
     */
    public function report(array $game, string $reporterId, string $accusedId, string $reason): array
    {
        if ($reporterId === $accusedId) {
            return [$game, ['ok' => false, 'error' => 'You cannot report yourself.']];
        }
        if (!isset($game['players'][$accusedId])) {
            return [$game, ['ok' => false, 'error' => 'That player is not in this game.']];
        }
        if (!$this->reasonIsValid($reason)) {
            return [$game, ['ok' => false, 'error' => 'Choose a reason for the report.']];
        }

        $accused = $game['players'][$accusedId];
        if (!empty($accused['record']['disqualified'])) {
            return [$game, ['ok' => false, 'error' => 'That player is already out of the election.']];
        }

        // One report per reporter per accused, ever. This is what stops the
        // count being inflated by a single player.
        if (isset($accused['record']['reportsAgainst'][$reporterId])) {
            return [$game, ['ok' => false, 'error' => 'You have already reported that player.']];
        }

        $accused['record']['reportsAgainst'][$reporterId] = [
            'reason' => $reason,
            'at' => time(),
        ];
        $game['players'][$reporterId]['record']['reportsMade'][$accusedId] = true;

        $count = count($accused['record']['reportsAgainst']);
        $game['players'][$accusedId] = $accused;

        $result = [
            'ok' => true,
            'reports' => $count,
            'threshold' => (int) $this->config['reportsToOpen'],
            'opened' => false,
        ];

        if ($count >= (int) $this->config['reportsToOpen']) {
            [$game, $investigation] = $this->open($game, $accusedId);
            $result['opened'] = true;
            $result['investigation'] = $investigation;
        }

        return [$game, $result];
    }

    /**
     * The hidden evidence score, 0-100. Never shown to players — they see the
     * report count and the accused player's heat, and have to judge from that.
     */
    public function evidenceFor(array $player, int $reports, float $roll): float
    {
        $cfg = $this->config['evidence'];

        $risky = 0;
        foreach ($player['actions'] ?? [] as $a) {
            if (($a['group'] ?? '') === 'risky') {
                $risky++;
            }
        }
        $fromRisky = min((float) $cfg['riskyActionCap'], $risky * (float) $cfg['perRiskyAction']);
        $fromHeat = (float) $player['heat'] * (float) $cfg['heatWeight'];

        $priors = 0;
        foreach ($player['record']['penalties'] ?? [] as $pen) {
            $priors++;
        }
        $fromPriors = min((float) $cfg['priorPenaltyCap'], $priors * (float) $cfg['perPriorPenalty']);

        $over = max(0, $reports - (int) $this->config['reportsToOpen']);
        $fromReports = $over * (float) $cfg['perReportOverThreshold'];

        $noise = ($roll - 0.5) * 2 * (float) $cfg['randomSpread'];

        $score = $fromRisky + $fromHeat + $fromPriors + $fromReports + $noise;
        return max(0.0, min((float) $cfg['max'], $score));
    }

    /** Open and immediately resolve an investigation into one player. */
    public function open(array $game, string $accusedId): array
    {
        $player = $game['players'][$accusedId];
        $reports = count($player['record']['reportsAgainst']);
        $seq = count($player['record']['investigations']);

        $rolls = Campaign::rollsFor($game['id'] . ':inv:' . $accusedId, $seq);
        $evidence = $this->evidenceFor($player, $reports, $rolls['spare']);
        $outcome = $this->pickOutcome($evidence, $reports, $rolls['outcome']);

        // Announcing an investigation costs a little support on its own.
        $reaction = $this->config['publicReaction']['opened'];
        $player = $this->applySupportHit($player, (float) $reaction['support'], (int) $reaction['seats']);

        [$player, $applied] = $this->applyOutcome($player, $outcome, $game);

        $record = [
            'id' => bin2hex(random_bytes(6)),
            'accusedId' => $accusedId,
            'reports' => $reports,
            'highPriority' => $reports >= (int) $this->config['reportsForHighPriority'],
            'heatAtOpen' => (float) $player['heat'],
            'outcomeId' => $outcome['id'],
            'outcomeLabel' => $outcome['label'],
            'text' => $outcome['text'],
            'fine' => $applied['fine'],
            'restrictTurns' => $applied['restrictTurns'],
            'disqualified' => $applied['disqualified'],
            'note' => $applied['note'],
            'openedAt' => time(),
        ];

        $player['record']['investigations'][] = $record;
        if (!empty($outcome['counts'])) {
            $player['record']['penalties'][] = $outcome['id'];
        }

        // Reports are consumed: the slate is cleared so the same two reports
        // cannot trigger a second investigation immediately.
        $player['record']['reportsAgainst'] = [];

        $game['players'][$accusedId] = $player;
        $game['lastInvestigation'] = $record;

        return [$game, $record];
    }

    /**
     * Choose an outcome. Weights are shifted by the evidence score, so a clean
     * player skews towards CLEARED and a dirty one towards a penalty — but
     * neither is certain.
     */
    public function pickOutcome(float $evidence, int $reports, float $roll): array
    {
        $scale = ($evidence / (float) $this->config['evidence']['max'] - 0.5) * 2; // -1..1
        $pool = [];

        foreach ($this->config['outcomes'] as $o) {
            if (isset($o['minEvidence']) && $evidence < (float) $o['minEvidence']) {
                continue;
            }
            if (isset($o['minReports']) && $reports < (int) $o['minReports']) {
                continue;
            }
            $bias = (float) ($o['evidenceBias'] ?? 0);
            $weight = (float) $o['weight'] * (1 + $bias * $scale);
            $o['weight'] = max(0.01, $weight);
            $pool[] = $o;
        }

        if (!$pool) {
            return $this->config['outcomes'][0];
        }
        return Campaign::weightedPick($pool, $roll);
    }

    /** Apply a finding: money, heat, support, restriction, disqualification. */
    private function applyOutcome(array $player, array $outcome, array $game): array
    {
        $applied = ['fine' => 0, 'restrictTurns' => 0, 'disqualified' => false, 'note' => ''];

        if (!empty($outcome['fine'])) {
            $fine = (int) $outcome['fine'];
            $remaining = $this->campaign->remaining($player);

            if ($fine <= $remaining) {
                // Fines come straight out of what is left to spend.
                $player['spent'] = (int) $player['spent'] + $fine;
                $applied['fine'] = $fine;
            } else {
                // Never let a budget go negative: take what there is, then
                // convert the shortfall into a different penalty.
                $player['spent'] = (int) $player['budget'];
                $applied['fine'] = $remaining;
                $fallback = $this->config['insufficientFunds'];
                $player['record']['restrictedUntilTurn'] = max(
                    (int) $player['record']['restrictedUntilTurn'],
                    (int) ($game['turn'] ?? 1) + (int) $fallback['restrictTurns']
                );
                $applied['restrictTurns'] = (int) $fallback['restrictTurns'];
                $player = $this->applySupportHit($player, (float) $fallback['support'], (int) $fallback['seats']);
                $applied['note'] = $fallback['text'];
            }
        }

        if (!empty($outcome['restrictTurns'])) {
            $player['record']['restrictedUntilTurn'] = max(
                (int) $player['record']['restrictedUntilTurn'],
                (int) ($game['turn'] ?? 1) + (int) $outcome['restrictTurns']
            );
            $applied['restrictTurns'] = (int) $outcome['restrictTurns'];
        }

        if (!empty($outcome['disqualify'])) {
            $player['record']['disqualified'] = true;
            $applied['disqualified'] = true;
        }

        if (isset($outcome['heat'])) {
            $max = (float) $this->campaign->config()['heat']['max'];
            $player['heat'] = max(0.0, min($max, (float) $player['heat'] + (float) $outcome['heat']));
        }

        if (!empty($outcome['support'])) {
            $player = $this->applySupportHit($player, (float) $outcome['support'], (int) ($outcome['seats'] ?? 3));
        }

        return [$player, $applied];
    }

    /** Move the player's support in their most contested seats. */
    private function applySupportHit(array $player, float $delta, int $seats): array
    {
        if (!$delta || empty($player['support'])) {
            return $player;
        }

        // Marginals first: that is where a swing actually changes the result.
        $numbers = array_keys($player['support']);
        usort($numbers, function ($a, $b) use ($player) {
            return $this->marginOf($player, $a) <=> $this->marginOf($player, $b);
        });

        $count = min($seats, count($numbers));
        for ($i = 0; $i < $count; $i++) {
            $k = (string) $numbers[$i];
            $seat = $player['support'][$k];
            $before = $seat[$player['partyId']] ?? 0;
            $seat[$player['partyId']] = max(1.0, min(95.0, $before + $delta));
            $player['support'][$k] = Campaign::normalise($seat);
        }
        return $player;
    }

    /** $number arrives as an int from array_keys, so accept either. */
    private function marginOf(array $player, $number): float
    {
        $seat = $player['support'][(string) $number] ?? [];
        if (!$seat) {
            return 0.0;
        }
        $mine = $seat[$player['partyId']] ?? 0;
        $best = 0;
        foreach ($seat as $pid => $v) {
            if ($pid !== $player['partyId'] && $v > $best) {
                $best = $v;
            }
        }
        return abs($mine - $best);
    }

    /** True if this player currently cannot take risky actions. */
    public static function isRestricted(array $player, int $turn): bool
    {
        return (int) ($player['record']['restrictedUntilTurn'] ?? 0) > $turn;
    }
}
