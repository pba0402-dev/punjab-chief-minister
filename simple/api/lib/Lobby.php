<?php
/**
 * Lobby rules.
 * ------------------------------------------------------------------
 * Everything that decides what a game looks like and what a player may do.
 * Pure functions over the game array — no HTTP, no storage — so the rules
 * can be reasoned about and tested on their own.
 */
declare(strict_types=1);

final class Lobby
{
    public const MAX_PLAYERS = 4;
    public const MIN_PLAYERS = 2;

    /** A player is "connected" if we have heard from them recently. */
    public const CONNECT_TIMEOUT = 20;

    /** Party ids a player may pick. Mirrors js/data/parties.js. */
    public const PARTIES = ['aap', 'inc', 'bjp', 'sad'];

    public static function newGame(string $code): array
    {
        $now = time();
        return [
            'id' => bin2hex(random_bytes(16)),
            'code' => $code,
            'phase' => 'lobby', // lobby | election
            'maxPlayers' => self::MAX_PLAYERS,
            'minPlayers' => self::MIN_PLAYERS,
            'hostId' => null,
            'turn' => 0,
            'players' => [],
            'constituencies' => (object) [],
            'results' => null,
            'createdAt' => $now,
            'updatedAt' => $now,
        ];
    }

    public static function newPlayer(int $slot): array
    {
        $now = time();
        return [
            'id' => bin2hex(random_bytes(8)),
            'token' => bin2hex(random_bytes(16)),
            'slot' => $slot,
            'partyId' => null,
            'candidateName' => '',
            'slogan' => '',
            'budget' => 0,
            'ready' => false,
            'joinedAt' => $now,
            'lastSeen' => $now,
        ];
    }

    /** The lowest free slot number, or null if the game is full. */
    public static function nextFreeSlot(array $game): ?int
    {
        $taken = [];
        foreach ($game['players'] as $p) {
            $taken[(int) $p['slot']] = true;
        }
        for ($slot = 1; $slot <= self::MAX_PLAYERS; $slot++) {
            if (!isset($taken[$slot])) {
                return $slot;
            }
        }
        return null;
    }

    public static function isConnected(array $player, ?int $now = null): bool
    {
        $now = $now ?? time();
        return ($now - (int) $player['lastSeen']) <= self::CONNECT_TIMEOUT;
    }

    public static function connectedPlayers(array $game): array
    {
        $now = time();
        return array_values(array_filter($game['players'], static function ($p) use ($now) {
            return self::isConnected($p, $now);
        }));
    }

    /**
     * If the host has dropped, hand the role to the longest-present connected
     * player. Returns the game, changed or not.
     */
    public static function ensureHost(array $game): array
    {
        $host = $game['hostId'] !== null && isset($game['players'][$game['hostId']])
            ? $game['players'][$game['hostId']]
            : null;

        if ($host !== null && self::isConnected($host)) {
            return $game;
        }

        $candidates = self::connectedPlayers($game);
        if (count($candidates) === 0) {
            return $game; // nobody home; leave the host as-is for reconnection
        }

        usort($candidates, static function ($a, $b) {
            return $a['joinedAt'] <=> $b['joinedAt'] ?: $a['slot'] <=> $b['slot'];
        });
        $game['hostId'] = $candidates[0]['id'];
        return $game;
    }

    /** Party ids already claimed, excluding one player if given. */
    public static function takenParties(array $game, ?string $exceptPlayerId = null): array
    {
        $taken = [];
        foreach ($game['players'] as $id => $p) {
            if ($exceptPlayerId !== null && $id === $exceptPlayerId) {
                continue;
            }
            if (!empty($p['partyId'])) {
                $taken[] = $p['partyId'];
            }
        }
        return $taken;
    }

    public static function partyIsFree(array $game, string $partyId, string $playerId): bool
    {
        return !in_array($partyId, self::takenParties($game, $playerId), true);
    }

    /** A player is startable when they have a party, a name, a slogan and a budget. */
    public static function playerIsComplete(array $p): bool
    {
        return !empty($p['partyId'])
            && trim((string) $p['candidateName']) !== ''
            && trim((string) $p['slogan']) !== ''
            && (int) $p['budget'] > 0;
    }

    /**
     * Why the host cannot start yet, or null when they can.
     * Only connected players are counted — a player who closed their laptop
     * should not be able to hold the game hostage.
     */
    public static function startBlockedReason(array $game): ?string
    {
        if ($game['phase'] !== 'lobby') {
            return 'The election has already started.';
        }

        $connected = self::connectedPlayers($game);
        $count = count($connected);

        if ($count < self::MIN_PLAYERS) {
            return 'Waiting for at least ' . self::MIN_PLAYERS . ' players.';
        }

        foreach ($connected as $p) {
            if (!self::playerIsComplete($p)) {
                return 'Every player needs a party, a candidate, a slogan and a budget.';
            }
            if (empty($p['ready'])) {
                return 'Waiting for all players to be ready.';
            }
        }
        return null;
    }

    /**
     * The view sent to clients. Strips secrets, adds derived fields, and pads
     * the roster out to four slots so the lobby can show empty seats.
     */
    public static function publicView(array $game, ?string $viewerId = null): array
    {
        $now = time();
        $bySlot = [];
        foreach ($game['players'] as $p) {
            $bySlot[(int) $p['slot']] = $p;
        }

        $slots = [];
        for ($slot = 1; $slot <= self::MAX_PLAYERS; $slot++) {
            if (!isset($bySlot[$slot])) {
                $slots[] = ['slot' => $slot, 'empty' => true];
                continue;
            }
            $p = $bySlot[$slot];
            $slots[] = [
                'slot' => $slot,
                'empty' => false,
                'id' => $p['id'],
                'isHost' => $game['hostId'] === $p['id'],
                'isYou' => $viewerId !== null && $viewerId === $p['id'],
                'connected' => self::isConnected($p, $now),
                'partyId' => $p['partyId'],
                'candidateName' => $p['candidateName'],
                'slogan' => $p['slogan'],
                'budget' => (int) $p['budget'],
                'ready' => (bool) $p['ready'],
                'complete' => self::playerIsComplete($p),
            ];
        }

        return [
            'code' => $game['code'],
            'phase' => $game['phase'],
            'turn' => (int) $game['turn'],
            'maxPlayers' => self::MAX_PLAYERS,
            'minPlayers' => self::MIN_PLAYERS,
            'playerCount' => count($game['players']),
            'connectedCount' => count(self::connectedPlayers($game)),
            'hostId' => $game['hostId'],
            'youAreHost' => $viewerId !== null && $viewerId === $game['hostId'],
            'players' => $slots,
            'takenParties' => self::takenParties($game),
            'startBlockedReason' => self::startBlockedReason($game),
            'updatedAt' => (int) $game['updatedAt'],
        ];
    }
}
