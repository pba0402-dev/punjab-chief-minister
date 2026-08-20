<?php
/**
 * Coalition negotiation.
 * ------------------------------------------------------------------
 * After a hung assembly, one player proposes terms to another: who is Chief
 * Minister, who is Deputy, how the cabinet splits, a policy priority and how
 * campaign resources are shared next time. The other player accepts or
 * rejects. Rejection ends that pairing and anyone can try another.
 *
 * Version 1 allows two partners. The record shape is a list, so three or four
 * would not need this rewritten.
 */
declare(strict_types=1);

final class Coalition
{
    private array $config;

    public function __construct(Campaign $campaign)
    {
        $this->config = $campaign->config()['coalition'];
    }

    public function config(): array
    {
        return $this->config;
    }

    private function validId(string $listKey, string $id): bool
    {
        foreach ($this->config[$listKey] as $item) {
            if ($item['id'] === $id) {
                return true;
            }
        }
        return false;
    }

    /**
     * Put an offer on the table. Returns [game, result].
     * Only one proposal can be live at a time, so the screen never has to
     * explain competing offers.
     */
    public function propose(array $game, string $fromId, array $terms): array
    {
        if (($game['phase'] ?? '') !== 'hung') {
            return [$game, ['ok' => false, 'error' => 'There is no government to form.']];
        }

        $toId = (string) ($terms['partnerId'] ?? '');
        if ($toId === '' || !isset($game['players'][$toId]) || $toId === $fromId) {
            return [$game, ['ok' => false, 'error' => 'Choose a partner to negotiate with.']];
        }
        if (!empty($game['coalition']['status']) && $game['coalition']['status'] === 'formed') {
            return [$game, ['ok' => false, 'error' => 'A government has already been formed.']];
        }
        if (!empty($game['coalition']['proposal'])) {
            return [$game, ['ok' => false, 'error' => 'There is already an offer on the table.']];
        }

        $cmId = (string) ($terms['chiefMinisterId'] ?? $fromId);
        if ($cmId !== $fromId && $cmId !== $toId) {
            return [$game, ['ok' => false, 'error' => 'The Chief Minister must be one of the two partners.']];
        }

        $cabinet = (string) ($terms['cabinet'] ?? '');
        $policy = (string) ($terms['policy'] ?? '');
        $resources = (string) ($terms['resources'] ?? '');
        if (!$this->validId('cabinetSplits', $cabinet)) {
            return [$game, ['ok' => false, 'error' => 'Choose how the cabinet is split.']];
        }
        if (!$this->validId('policies', $policy)) {
            return [$game, ['ok' => false, 'error' => 'Choose a policy priority.']];
        }
        if (!$this->validId('resourceTerms', $resources)) {
            return [$game, ['ok' => false, 'error' => 'Choose the resource agreement.']];
        }

        $seatsFrom = $this->seatsFor($game, $fromId);
        $seatsTo = $this->seatsFor($game, $toId);
        $combined = $seatsFrom + $seatsTo;
        if ($combined < (int) $this->config['requiredSeats']) {
            return [$game, ['ok' => false, 'error' =>
                'Together you have ' . $combined . ' seats — short of the '
                . $this->config['requiredSeats'] . ' needed.']];
        }

        $game['coalition']['proposal'] = [
            'id' => bin2hex(random_bytes(6)),
            'fromId' => $fromId,
            'toId' => $toId,
            'chiefMinisterId' => $cmId,
            'deputyId' => $cmId === $fromId ? $toId : $fromId,
            'cabinet' => $cabinet,
            'policy' => $policy,
            'resources' => $resources,
            'seatsFrom' => $seatsFrom,
            'seatsTo' => $seatsTo,
            'combined' => $combined,
            'proposedAt' => time(),
        ];
        $game['coalition']['status'] = 'negotiating';

        return [$game, ['ok' => true, 'proposal' => $game['coalition']['proposal']]];
    }

    /** Accept the live offer. Only the player it was made to may accept. */
    public function accept(array $game, string $playerId): array
    {
        $proposal = $game['coalition']['proposal'] ?? null;
        if (!$proposal) {
            return [$game, ['ok' => false, 'error' => 'There is no offer to accept.']];
        }
        if ($proposal['toId'] !== $playerId) {
            return [$game, ['ok' => false, 'error' => 'That offer was not made to you.']];
        }

        $game['coalition'] = [
            'status' => 'formed',
            'members' => [$proposal['fromId'], $proposal['toId']],
            'chiefMinisterId' => $proposal['chiefMinisterId'],
            'deputyId' => $proposal['deputyId'],
            'cabinet' => $proposal['cabinet'],
            'policy' => $proposal['policy'],
            'resources' => $proposal['resources'],
            'seats' => [
                $proposal['fromId'] => $proposal['seatsFrom'],
                $proposal['toId'] => $proposal['seatsTo'],
            ],
            'combined' => $proposal['combined'],
            'formedAt' => time(),
            'history' => array_merge($game['coalition']['history'] ?? [], [[
                'event' => 'formed',
                'fromId' => $proposal['fromId'],
                'toId' => $proposal['toId'],
                'at' => time(),
            ]]),
            'proposal' => null,
        ];
        $game['phase'] = 'government';

        return [$game, ['ok' => true, 'coalition' => $game['coalition']]];
    }

    /**
     * Reject the live offer, or withdraw your own. Talks fail and the table
     * clears, so another pairing can be tried.
     */
    public function reject(array $game, string $playerId, string $note = ''): array
    {
        $proposal = $game['coalition']['proposal'] ?? null;
        if (!$proposal) {
            return [$game, ['ok' => false, 'error' => 'There is no offer on the table.']];
        }
        if ($proposal['toId'] !== $playerId && $proposal['fromId'] !== $playerId) {
            return [$game, ['ok' => false, 'error' => 'That offer is not yours to answer.']];
        }

        $withdrawn = $proposal['fromId'] === $playerId;
        $game['coalition']['proposal'] = null;
        $game['coalition']['status'] = 'failed';
        $game['coalition']['history'][] = [
            'event' => $withdrawn ? 'withdrawn' : 'rejected',
            'by' => $playerId,
            'fromId' => $proposal['fromId'],
            'toId' => $proposal['toId'],
            'note' => mb_substr($note, 0, 120),
            'at' => time(),
        ];

        return [$game, ['ok' => true, 'failed' => true, 'withdrawn' => $withdrawn]];
    }

    private function seatsFor(array $game, string $playerId): int
    {
        foreach ($game['result']['standings'] ?? [] as $s) {
            if ($s['playerId'] === $playerId) {
                return (int) $s['seats'];
            }
        }
        return 0;
    }

    public static function newState(): array
    {
        return [
            'status' => 'none', // none | negotiating | formed | failed
            'members' => [],
            'proposal' => null,
            'history' => [],
        ];
    }
}
