<?php
/**
 * Election day and government formation.
 * ------------------------------------------------------------------
 * Counts all 117 seats, decides whether anyone has a majority, and if not
 * opens the door to coalition talks.
 *
 * Every player campaigns on one shared board, so there is nothing to merge at
 * the count: the standing in each seat on election morning is the standing all
 * four players have been watching all game. What the count adds is noise, so a
 * narrow lead is never a certainty, and the rule that a disqualified player
 * wins nothing.
 */
declare(strict_types=1);

final class Election
{
    private Campaign $campaign;
    private array $config;

    public function __construct(Campaign $campaign)
    {
        $this->campaign = $campaign;
        $this->config = $campaign->config()['election'];
    }

    /**
     * Decide all 117 seats from the shared board.
     * Returns the full result: per-seat winners, party totals, and the verdict.
     */
    public function run(array $game): array
    {
        $board = Rounds::boardOf($game);
        $seatNumbers = array_map('intval', array_keys($board));
        sort($seatNumbers, SORT_NUMERIC);

        // Which player is playing which party.
        $byParty = [];
        foreach ($game['players'] as $pid => $p) {
            if (!empty($p['partyId'])) {
                $byParty[$p['partyId']] = $pid;
            }
        }

        $rand = Campaign::seededSequence($game['id'] . ':electionday');
        $noise = (float) $this->config['seatNoise'];

        $perSeat = [];
        // The parties in this game, invented by whoever is playing.
        $partyIds = array_keys($byParty);
        if ($partyIds === []) {
            $partyIds = array_map(
                static fn($p) => (string) ($p['id'] ?? ''),
                $game['parties'] ?? []
            );
        }

        $totals = [];
        foreach ($partyIds as $party) {
            $totals[$party] = 0;
        }

        foreach ($seatNumbers as $number) {
            $merged = (array) $board[(string) $number];

            /*
             * Polling day works on shares, not on raw influence: what decides
             * a seat is how the campaigns stand against each other in it, and
             * the noise has to be in the same units as the thing it disturbs.
             *
             * But part of every seat is still undecided, and that part is
             * larger the less work has been done there. One rally in an
             * untouched seat reads as 100% of a seat almost nobody has been
             * reached in, and without this the whole board could be won by
             * turning up once everywhere. See campaign-config.json.
             */
            $influence = 0.0;
            foreach ($merged as $v) {
                $influence += max(0.0, (float) $v);
            }
            $k = (float) ($this->config['undecidedWeight'] ?? 0);
            $undecided = $k > 0 ? $k / ($k + $influence) : 0.0;

            $final = [];
            foreach ($partyIds as $party) {
                $final[$party] = $undecided * 100 * $rand();
            }
            foreach (Campaign::shares($merged) as $party => $share) {
                $final[$party] = ($final[$party] ?? 0)
                    + (1 - $undecided) * $share
                    + ($rand() - 0.5) * 2 * $noise;
            }
            foreach ($final as $party => $v) {
                $final[$party] = max(0.01, $v);
            }

            $final = Campaign::normalise($final);

            $winner = null;
            $best = -1;
            $runnerUp = 0;
            foreach ($final as $party => $value) {
                if ($value > $best) {
                    $runnerUp = $best;
                    $best = $value;
                    $winner = $party;
                } elseif ($value > $runnerUp) {
                    $runnerUp = $value;
                }
            }

            // A disqualified player cannot win seats.
            if (isset($byParty[$winner]) && !empty($game['players'][$byParty[$winner]]['record']['disqualified'])) {
                unset($final[$winner]);
                $winner = null;
                $best = -1;
                foreach ($final as $party => $value) {
                    if ($value > $best) {
                        $best = $value;
                        $winner = $party;
                    }
                }
            }

            $totals[$winner] = ($totals[$winner] ?? 0) + 1;
            $perSeat[(string) $number] = [
                'winner' => $winner,
                'share' => round($best, 1),
                'margin' => round($best - max(0, $runnerUp), 1),
            ];
        }

        return $this->verdict($game, $perSeat, $totals, $byParty, $board);
    }

    /** Turn seat totals into a government, a hung assembly, or neither. */
    private function verdict(array $game, array $perSeat, array $totals, array $byParty, array $board = []): array
    {
        $majority = (int) $this->config['majority'];
        $leaders = $board === [] ? [] : Territory::leadersOf($board);

        $standings = [];
        foreach ($totals as $party => $seats) {
            $pid = $byParty[$party] ?? null;
            $player = $pid !== null ? $game['players'][$pid] : null;
            $standings[] = [
                'party' => $party,
                'seats' => $seats,
                'playerId' => $pid,
                'candidate' => $player['candidateName'] ?? null,
                'slot' => $player['slot'] ?? null,
                'disqualified' => !empty($player['record']['disqualified']),

                // What the campaign built, as opposed to what it won.
                // Districts come off the final board; grant income is what
                // those districts actually paid across the whole campaign,
                // which is not the same number as holding them at the end.
                'districts' => $leaders === []
                    ? 0
                    : count($this->campaign->territory()->heldBy($leaders, (string) $party)),
                'grantIncome' => (int) ($player['grantTotalEarned'] ?? 0),
            ];
        }
        usort($standings, static fn($a, $b) => $b['seats'] <=> $a['seats']);

        $winner = null;
        foreach ($standings as $s) {
            if ($s['seats'] >= $majority && !$s['disqualified']) {
                $winner = $s;
                break;
            }
        }

        return [
            'perSeat' => $perSeat,
            'standings' => $standings,
            'totalSeats' => (int) $this->config['totalSeats'],
            'majority' => $majority,
            'outcome' => $winner !== null ? 'majority' : 'hung',
            'winner' => $winner,
            'declaredAt' => time(),
        ];
    }

    /**
     * Which pairs of players could form a government between them.
     * Version 1 allows two partners; the shape allows more later.
     */
    public function possibleCoalitions(array $result): array
    {
        $majority = (int) $this->config['majority'];
        $eligible = array_values(array_filter(
            $result['standings'],
            static fn($s) => $s['playerId'] !== null && !$s['disqualified'] && $s['seats'] > 0
        ));

        $pairs = [];
        for ($i = 0; $i < count($eligible); $i++) {
            for ($j = $i + 1; $j < count($eligible); $j++) {
                $combined = $eligible[$i]['seats'] + $eligible[$j]['seats'];
                if ($combined >= $majority) {
                    $pairs[] = [
                        'a' => $eligible[$i],
                        'b' => $eligible[$j],
                        'combined' => $combined,
                    ];
                }
            }
        }
        usort($pairs, static fn($x, $y) => $y['combined'] <=> $x['combined']);
        return $pairs;
    }
}
