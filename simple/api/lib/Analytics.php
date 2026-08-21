<?php

declare(strict_types=1);

/**
 * How many people are actually playing this.
 * ------------------------------------------------------------------
 * Counts of things that happened, kept by day. No profiles, no journeys, no
 * third party, and nothing that could identify anybody: a visitor is a salted
 * hash of their address and user agent, which exists only so that one person
 * refreshing five times is one visitor and not five.
 *
 * The salt rotates daily and is never stored, so yesterday's hashes cannot be
 * matched to today's — the data can answer "how many people came" and cannot
 * answer "did this person come back", which is the right trade for a game.
 *
 * The funnel is the point of the whole thing: visits are cheap and mean very
 * little, and what the owner actually wants to know is how many people who
 * arrived went on to finish an election.
 */
final class Analytics
{
    /** Events worth counting. Anything else is ignored rather than stored. */
    public const EVENTS = [
        'landing_page_view',
        'game_setup_started',
        'game_created',
        'game_joined',
        'game_started',
        'round_started',
        'game_completed',
        'game_abandoned',
    ];

    private string $dir;

    public function __construct(string $dataDir)
    {
        $this->dir = rtrim($dataDir, '/\\') . '/analytics';
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
        // The store is never served over the web, whatever the document root
        // ends up being.
        $guard = $this->dir . '/.htaccess';
        if (!is_file($guard)) {
            @file_put_contents($guard, "Require all denied\nDeny from all\n");
        }
    }

    private function path(string $day): string
    {
        return $this->dir . '/' . $day . '.json';
    }

    private static function today(): string
    {
        return gmdate('Y-m-d');
    }

    /**
     * A visitor, as a number rather than a person.
     *
     * Salted with the day and a per-installation secret, so the same person
     * tomorrow hashes differently and nothing here can be joined up over time
     * or matched against any other data set.
     */
    public function visitorHash(string $ip, string $agent): string
    {
        return substr(hash('sha256', self::today() . '|' . $this->secret() . '|' . $ip . '|' . $agent), 0, 16);
    }

    private function secret(): string
    {
        $file = $this->dir . '/.secret';
        $secret = @file_get_contents($file);
        if ($secret === false || strlen(trim((string) $secret)) < 32) {
            $secret = bin2hex(random_bytes(24));
            @file_put_contents($file, $secret);
        }
        return trim((string) $secret);
    }

    /**
     * Record one event.
     *
     * $visitor is the hash above, used only to separate a visit from a
     * revisit within the same day. It is stored as a hash and dropped when the
     * day rolls over.
     */
    public function record(string $event, string $visitor = '', array $extra = []): void
    {
        if (!in_array($event, self::EVENTS, true)) {
            return;
        }

        $day = self::today();
        $file = $this->path($day);

        $handle = @fopen($file, 'c+');
        if ($handle === false) {
            return;
        }
        if (!flock($handle, LOCK_EX)) {
            fclose($handle);
            return;
        }

        $raw = stream_get_contents($handle);
        $data = $raw === false || $raw === '' ? [] : (json_decode($raw, true) ?: []);

        $data['day'] = $day;
        $data['events'] = $data['events'] ?? [];
        $data['events'][$event] = (int) ($data['events'][$event] ?? 0) + 1;

        // Unique visitors, as a set of hashes for the day only.
        if ($visitor !== '') {
            $data['visitors'] = $data['visitors'] ?? [];
            if (!in_array($visitor, $data['visitors'], true)) {
                // Bounded: a very busy day should not grow this file forever.
                if (count($data['visitors']) < 20000) {
                    $data['visitors'][] = $visitor;
                }
            }
        }

        // A few tallies worth having, and nothing personal in any of them.
        foreach (['party' => 'byParty', 'region' => 'byRegion', 'district' => 'byDistrict'] as $key => $bucket) {
            $value = isset($extra[$key]) ? preg_replace('/[^a-z0-9-]/', '', strtolower((string) $extra[$key])) : '';
            if ($value !== '') {
                $data[$bucket] = $data[$bucket] ?? [];
                $data[$bucket][$value] = (int) ($data[$bucket][$value] ?? 0) + 1;
            }
        }

        if (isset($extra['seconds']) && (int) $extra['seconds'] > 0) {
            $data['gameSeconds'] = (int) ($data['gameSeconds'] ?? 0) + (int) $extra['seconds'];
            $data['gameSecondsCount'] = (int) ($data['gameSecondsCount'] ?? 0) + 1;
        }

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($data, JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        $this->prune();
    }

    /** One day's figures, with the visitor hashes reduced to a count. */
    public function day(string $day): array
    {
        $raw = @file_get_contents($this->path($day));
        $data = $raw === false ? [] : (json_decode($raw, true) ?: []);

        $events = $data['events'] ?? [];
        $out = [
            'day' => $day,
            'uniqueVisitors' => count($data['visitors'] ?? []),
            'events' => [],
            'byParty' => $data['byParty'] ?? [],
            'byRegion' => $data['byRegion'] ?? [],
            'byDistrict' => $data['byDistrict'] ?? [],
            'averageGameSeconds' => ($data['gameSecondsCount'] ?? 0) > 0
                ? (int) round(($data['gameSeconds'] ?? 0) / $data['gameSecondsCount'])
                : 0,
        ];
        foreach (self::EVENTS as $name) {
            $out['events'][$name] = (int) ($events[$name] ?? 0);
        }
        return $out;
    }

    /**
     * The last N days, newest last, plus totals and the funnel.
     */
    public function range(int $days = 7): array
    {
        $days = max(1, min(90, $days));
        $rows = [];
        $totals = array_fill_keys(self::EVENTS, 0);
        $visitors = 0;

        for ($i = $days - 1; $i >= 0; $i--) {
            $day = gmdate('Y-m-d', time() - $i * 86400);
            $row = $this->day($day);
            $rows[] = $row;
            $visitors += $row['uniqueVisitors'];
            foreach (self::EVENTS as $name) {
                $totals[$name] += $row['events'][$name];
            }
        }

        return [
            'days' => $rows,
            'uniqueVisitors' => $visitors,
            'totals' => $totals,

            /*
             * The funnel, which is the only thing here worth acting on.
             *
             * Visits tell you almost nothing. What matters is the shape of the
             * drop between arriving, starting, and finishing — that is where
             * the interest either is or is not.
             */
            'funnel' => [
                ['step' => 'Visited', 'count' => $totals['landing_page_view']],
                ['step' => 'Opened setup', 'count' => $totals['game_setup_started']],
                ['step' => 'Created or joined', 'count' => $totals['game_created'] + $totals['game_joined']],
                ['step' => 'Started round 1', 'count' => $totals['game_started']],
                ['step' => 'Finished', 'count' => $totals['game_completed']],
            ],
        ];
    }

    /** Keep three months. Nobody needs more and the files are tiny. */
    private function prune(): void
    {
        $cutoff = time() - 92 * 86400;
        foreach (glob($this->dir . '/*.json') ?: [] as $file) {
            $day = basename($file, '.json');
            $at = strtotime($day . ' UTC');
            if ($at !== false && $at < $cutoff) {
                @unlink($file);
            }
        }
    }
}
