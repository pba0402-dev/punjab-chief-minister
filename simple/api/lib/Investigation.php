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

        // One report per reporter per accused, for the whole game.
        //
        // reportsAgainst is cleared when an investigation resolves, so checking
        // only that would let two players cycle reports at a third and grind
        // them down with repeated inquiries — each one costs the accused some
        // support even when it clears them. reportsMade is never cleared, so it
        // is the check that actually holds.
        $alreadyReported = isset($accused['record']['reportsAgainst'][$reporterId])
            || !empty($game['players'][$reporterId]['record']['reportsMade'][$accusedId]);
        if ($alreadyReported) {
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
        $board = Rounds::boardOf($game);
        $reaction = $this->config['publicReaction']['opened'];
        [$player, $board] = $this->applySupportHit(
            $player,
            $board,
            (float) $reaction['support'],
            (int) $reaction['seats']
        );

        [$player, $board, $applied] = $this->applyOutcome($player, $board, $outcome, $game);

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
        $game['board'] = $board;
        $game['lastInvestigation'] = $record;

        // Leaders moved, so everyone's projected seats moved with them.
        $counts = $this->campaign->seatCounts($board, Lobby::partyIdsOf($game));
        foreach ($game['players'] as $pid => $p) {
            $party = (string) ($p['partyId'] ?? '');
            $game['players'][$pid]['seatsLed'] = $party === '' ? 0 : (int) ($counts[$party] ?? 0);
        }

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
    private function applyOutcome(array $player, array $board, array $outcome, array $game): array
    {
        $applied = ['fine' => 0, 'restrictTurns' => 0, 'disqualified' => false, 'note' => ''];

        if (!empty($outcome['fine'])) {
            $fine = (int) $outcome['fine'];
            $cash = (int) ($player['cash'] ?? 0);

            if ($fine <= $cash) {
                // A fine is paid out of actual cash in hand, not out of an
                // abstract allowance. Borrowed money is cash like any other,
                // so a campaign running on credit can still be fined.
                $player['cash'] = $cash - $fine;
                $player['finesPaid'] = (int) ($player['finesPaid'] ?? 0) + $fine;
                $applied['fine'] = $fine;
            } else {
                // Never let cash go negative: take what there is, then convert
                // the shortfall into a different penalty.
                $player['cash'] = 0;
                $player['finesPaid'] = (int) ($player['finesPaid'] ?? 0) + $cash;
                $applied['fine'] = $cash;
                $fallback = $this->config['insufficientFunds'];
                $player['record']['restrictedUntilTurn'] = max(
                    (int) $player['record']['restrictedUntilTurn'],
                    (int) ($game['turn'] ?? 1) + (int) $fallback['restrictTurns']
                );
                $applied['restrictTurns'] = (int) $fallback['restrictTurns'];
                [$player, $board] = $this->applySupportHit(
                    $player,
                    $board,
                    (float) $fallback['support'],
                    (int) $fallback['seats']
                );
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
            [$player, $board] = $this->applySupportHit(
                $player,
                $board,
                (float) $outcome['support'],
                (int) ($outcome['seats'] ?? 3)
            );
        }

        return [$player, $board, $applied];
    }

    /** Move the player's support in their most contested seats. */
    private function applySupportHit(array $player, array $board, float $delta, int $seats): array
    {
        $partyId = (string) ($player['partyId'] ?? '');
        if (!$delta || !$board || $partyId === '') {
            return [$player, $board];
        }

        // Marginals first: that is where a swing actually changes the result.
        $numbers = array_map('strval', array_keys($board));
        usort($numbers, function ($a, $b) use ($board, $partyId) {
            return $this->marginOf($board, $partyId, $a) <=> $this->marginOf($board, $partyId, $b);
        });

        $count = min($seats, count($numbers));
        for ($i = 0; $i < $count; $i++) {
            $k = $numbers[$i];
            $seat = $board[$k];
            $before = $seat[$partyId] ?? 0;
            $seat[$partyId] = max(1.0, min(95.0, $before + $delta));
            $board[$k] = Campaign::normalise($seat);
        }
        return [$player, $board];
    }

    /** $number arrives as an int from array_keys, so accept either. */
    private function marginOf(array $board, string $partyId, $number): float
    {
        $seat = $board[(string) $number] ?? [];
        if (!$seat) {
            return 0.0;
        }
        $mine = $seat[$partyId] ?? 0;
        $best = 0;
        foreach ($seat as $pid => $v) {
            if ($pid !== $partyId && $v > $best) {
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
