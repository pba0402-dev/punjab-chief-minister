<?php

declare(strict_types=1);

/**
 * Alliances, and the checkpoint that puts a campaign out of the election.
 * ------------------------------------------------------------------
 * Two players may agree to fight the election together. Offers close at the
 * end of the deadline round and an accepted alliance is locked until the
 * result — you cannot shop for a better partner at round nineteen, which is
 * what makes agreeing to one early a real commitment rather than a free
 * option.
 *
 * Allies see each other's priority districts, so they can divide the map. They
 * see nothing else: not each other's cash, not their heat, not what either of
 * them did quietly. An alliance is a pact, not a merger.
 *
 * At the checkpoint round the weakest campaign may be put out — but only one
 * that is genuinely out of it. A player still within reach of the majority, or
 * still close to the leader, survives, because a comeback is the best thing
 * that can happen in a game like this and a rule that forecloses it is a bad
 * rule.
 */
final class Alliances
{
    /* ------------------------------------------------------------ offers */

    /** Can these two still agree to anything? Returns a reason, or null. */
    public static function offerBlockedReason(array $game, string $fromId, string $toId, array $config): ?string
    {
        $cfg = $config['alliances'] ?? [];
        $deadline = (int) ($cfg['deadlineRound'] ?? 10);

        if (($game['phase'] ?? '') !== 'election') {
            return 'The election is not running.';
        }
        if ((int) ($game['round'] ?? 0) > $deadline) {
            return 'Alliances closed at the end of round ' . $deadline . '.';
        }
        if ($fromId === $toId) {
            return 'You cannot ally with yourself.';
        }

        $from = $game['players'][$fromId] ?? null;
        $to = $game['players'][$toId] ?? null;
        if (!$from || !$to) {
            return 'That player is not in this election.';
        }
        if (!empty($from['eliminated']) || !empty($to['eliminated'])) {
            return 'That player is out of the election.';
        }
        if (!empty($to['isAI'])) {
            return 'The other parties are not taking calls.';
        }
        if (!empty($from['allyId'])) {
            return 'You are already in an alliance.';
        }
        if (!empty($to['allyId'])) {
            return 'They are already in an alliance.';
        }
        return null;
    }

    /** Record an offer from one player to another. */
    public static function offer(array $game, string $fromId, string $toId): array
    {
        $offers = $game['allianceOffers'] ?? [];
        $offers[$fromId . '>' . $toId] = [
            'from' => $fromId,
            'to' => $toId,
            'round' => (int) ($game['round'] ?? 0),
            'at' => time(),
        ];
        $game['allianceOffers'] = $offers;
        return $game;
    }

    /** Withdraw an offer, or decline one made to you. */
    public static function drop(array $game, string $fromId, string $toId): array
    {
        $offers = $game['allianceOffers'] ?? [];
        unset($offers[$fromId . '>' . $toId]);
        $game['allianceOffers'] = $offers;
        return $game;
    }

    /** Offers made to one player, still standing. */
    public static function offersTo(array $game, string $playerId): array
    {
        $out = [];
        foreach (($game['allianceOffers'] ?? []) as $offer) {
            if (($offer['to'] ?? null) === $playerId) {
                $out[] = $offer;
            }
        }
        return $out;
    }

    /**
     * Accept an offer. Both players are marked, the pact is recorded, and
     * every other offer either of them has open is dropped — an alliance of
     * two cannot leave a third offer hanging.
     */
    public static function accept(array $game, string $accepterId, string $proposerId): array
    {
        $game['players'][$accepterId]['allyId'] = $proposerId;
        $game['players'][$proposerId]['allyId'] = $accepterId;

        $alliances = $game['alliances'] ?? [];
        $alliances[] = [
            'members' => [$proposerId, $accepterId],
            'round' => (int) ($game['round'] ?? 0),
            'at' => time(),
        ];
        $game['alliances'] = $alliances;

        $offers = [];
        foreach (($game['allianceOffers'] ?? []) as $key => $offer) {
            $involved = in_array($offer['from'] ?? '', [$accepterId, $proposerId], true)
                || in_array($offer['to'] ?? '', [$accepterId, $proposerId], true);
            if (!$involved) {
                $offers[$key] = $offer;
            }
        }
        $game['allianceOffers'] = $offers;

        return $game;
    }

    /** The party ids fighting together with this one, itself included. */
    public static function blocOf(array $game, string $playerId): array
    {
        $me = $game['players'][$playerId] ?? null;
        if (!$me) {
            return [];
        }
        $ids = [$playerId];
        $ally = $me['allyId'] ?? null;
        if ($ally !== null && isset($game['players'][$ally])) {
            $ids[] = $ally;
        }
        return $ids;
    }

    /* ------------------------------------------------------ elimination */

    /**
     * Who, if anybody, is put out at the checkpoint.
     *
     * Ranked on seats. The bottom campaign goes only if it is beyond saving:
     * far enough from the majority that the remaining rounds will not close
     * it, and far enough behind the leader that it is not simply second in a
     * tight race. Never applied when the game is already down to two.
     *
     * @return array{playerId:?string,reason:string,standings:array}
     */
    public static function review(array $game, array $config, array $seatCounts): array
    {
        $cfg = $config['elimination'] ?? [];
        $majority = (int) (($config['election'] ?? [])['majority'] ?? 59);
        $minPlayers = (int) ($cfg['minPlayersToEliminate'] ?? 3);
        $safeMajority = (int) ($cfg['safeIfWithinSeatsOfMajority'] ?? 20);
        $safeLeader = (int) ($cfg['safeIfWithinSeatsOfLeader'] ?? 12);

        $rows = [];
        foreach (($game['players'] ?? []) as $pid => $p) {
            if (!empty($p['eliminated'])) {
                continue;
            }
            $party = (string) ($p['partyId'] ?? '');
            $rows[] = [
                'playerId' => (string) $pid,
                'partyId' => $party,
                'isAI' => !empty($p['isAI']),
                'candidateName' => (string) ($p['candidateName'] ?? ''),
                'seats' => (int) ($seatCounts[$party] ?? 0),
            ];
        }

        usort($rows, static fn($a, $b) => $b['seats'] <=> $a['seats']);

        if (count($rows) <= max(2, $minPlayers - 1)) {
            return [
                'playerId' => null,
                'reason' => 'Too few campaigns left for a review.',
                'standings' => $rows,
            ];
        }

        $leader = $rows[0]['seats'];
        $bottom = $rows[count($rows) - 1];

        if ($bottom['seats'] >= $majority - $safeMajority) {
            return [
                'playerId' => null,
                'reason' => 'Every campaign is still within reach of a majority.',
                'standings' => $rows,
            ];
        }
        if ($leader - $bottom['seats'] <= $safeLeader) {
            return [
                'playerId' => null,
                'reason' => 'The field is too close to put anybody out.',
                'standings' => $rows,
            ];
        }

        return [
            'playerId' => $bottom['playerId'],
            'reason' => $bottom['candidateName'] . ' finished the review on '
                . $bottom['seats'] . ' seats, too far back to reach a majority.',
            'standings' => $rows,
        ];
    }

    /**
     * Put a campaign out. Their seats stay on the board — the support they
     * built does not evaporate because they stopped campaigning — but they
     * take no further part.
     */
    public static function eliminate(array $game, string $playerId, string $reason): array
    {
        if (!isset($game['players'][$playerId])) {
            return $game;
        }
        $game['players'][$playerId]['eliminated'] = true;
        $game['players'][$playerId]['eliminatedRound'] = (int) ($game['round'] ?? 0);
        $game['players'][$playerId]['roundReady'] = true;

        $log = $game['eliminations'] ?? [];
        $log[] = [
            'playerId' => $playerId,
            'partyId' => (string) ($game['players'][$playerId]['partyId'] ?? ''),
            'candidateName' => (string) ($game['players'][$playerId]['candidateName'] ?? ''),
            'round' => (int) ($game['round'] ?? 0),
            'reason' => $reason,
        ];
        $game['eliminations'] = $log;

        return $game;
    }
}
