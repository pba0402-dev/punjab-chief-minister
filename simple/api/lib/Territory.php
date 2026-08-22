<?php

declare(strict_types=1);

/**
 * Punjab's regions, its districts, and who holds them.
 * ------------------------------------------------------------------
 * Read from the same generated file the browser loads, so the server and the
 * client can never disagree about which seats make up a district or which
 * region that district sits in. The mapping is geography; the grant a district
 * pays is a game value scaled by size in tools/build-regions.mjs.
 *
 * A district is *held* only when one party leads every seat in it. Leading
 * eight of nine pays nothing, which is what makes the last seat in a district
 * worth more than the first seat in the next one.
 */
final class Territory
{
    /** @var array<int, array{id:string,name:string,region:string,seats:int[],grant:int}> */
    private array $districts;

    /** @var array<string, array{id:string,name:string,blurb:string}> */
    private array $regions;

    /** @var array<int, string> seat number => district id */
    private array $districtOfSeat = [];

    public function __construct(?string $dataPath = null)
    {
        $path = $dataPath ?? __DIR__ . '/../../js/data/regions.js';
        $js = @file_get_contents($path);

        $this->districts = [];
        $this->regions = [];

        if ($js !== false) {
            if (preg_match('/CMP\.REGIONS = (\[[\s\S]*?\]);/', $js, $m)) {
                foreach ((array) json_decode($m[1], true) as $r) {
                    $this->regions[(string) $r['id']] = $r;
                }
            }
            if (preg_match('/CMP\.DISTRICTS = (\[[\s\S]*?\]);/', $js, $m)) {
                $this->districts = (array) json_decode($m[1], true);
            }
        }

        foreach ($this->districts as $d) {
            foreach ($d['seats'] as $n) {
                $this->districtOfSeat[(int) $n] = (string) $d['id'];
            }
        }
    }

    /** @return array<int, array{id:string,name:string,region:string,seats:int[],grant:int}> */
    public function districts(): array
    {
        return $this->districts;
    }

    /** @return array<int, array{id:string,name:string,blurb:string}> */
    public function regions(): array
    {
        return array_values($this->regions);
    }

    public function district(string $id): ?array
    {
        foreach ($this->districts as $d) {
            if ($d['id'] === $id) {
                return $d;
            }
        }
        return null;
    }

    /** The region a seat sits in, or null if the seat is not known. */
    public function regionOfSeat($number): ?string
    {
        $id = $this->districtOfSeat[(int) $number] ?? null;
        if ($id === null) {
            return null;
        }
        $d = $this->district($id);
        return $d === null ? null : (string) $d['region'];
    }

    public function districtOfSeat($number): ?string
    {
        return $this->districtOfSeat[(int) $number] ?? null;
    }

    /**
     * Districts one party leads outright.
     *
     * @param array<string, string> $leaders seat number => party id
     * @return array<int, array{id:string,name:string,region:string,seats:int[],grant:int}>
     */
    /**
     * Districts a party controls.
     *
     * Pass `wonOf()` rather than `leadersOf()` to ask about permanent
     * control: every seat won outright, not merely led. Leading a district is
     * a position that can be taken back before the next round; controlling
     * one cannot, which is why the grant that comes with it is safe to pay
     * for the rest of the election.
     */
    public function heldBy(array $leaders, string $partyId): array
    {
        if ($partyId === '') {
            return [];
        }
        $held = [];
        foreach ($this->districts as $d) {
            if (!$d['seats']) {
                continue;
            }
            $all = true;
            foreach ($d['seats'] as $n) {
                if (($leaders[(string) $n] ?? null) !== $partyId) {
                    $all = false;
                    break;
                }
            }
            if ($all) {
                $held[] = $d;
            }
        }
        return $held;
    }

    /**
     * How every district stands for one party: seats led out of seats there,
     * and whether that amounts to holding it.
     *
     * @param array<string, string> $leaders
     * @return array<int, array{district:array,mine:int,total:int,held:bool}>
     */
    public function standings(array $leaders, string $partyId): array
    {
        $out = [];
        foreach ($this->districts as $d) {
            $mine = 0;
            foreach ($d['seats'] as $n) {
                if (($leaders[(string) $n] ?? null) === $partyId) {
                    $mine++;
                }
            }
            $out[] = [
                'district' => $d,
                'mine' => $mine,
                'total' => count($d['seats']),
                'held' => $mine === count($d['seats']) && $d['seats'] !== [],
            ];
        }
        return $out;
    }

    /** Who leads each seat right now. @return array<string, string> */
    /**
     * Who has won each seat, in the same shape as a leader map, so the same
     * district arithmetic answers both questions.
     */
    public static function wonOf(array $won): array
    {
        $out = [];
        foreach ($won as $seat => $row) {
            $out[(string) $seat] = (string) ($row['party'] ?? ($row->party ?? ''));
        }
        return $out;
    }

    /**
     * Who holds each seat right now: whoever leads it, or whoever won it.
     *
     * A grant is paid on this rather than on wins alone. Wins alone made a
     * grant something a campaign reached once and then kept, and meant most
     * games paid none at all; leading is live, so the grant is live with it.
     * A won seat still counts for its winner — winning is a stronger claim
     * than leading, and it cannot be campaigned in again anyway.
     */
    public static function ownersOf(array $board, array $won): array
    {
        $owners = self::leadersOf($board);
        foreach (self::wonOf($won) as $seat => $party) {
            if ($party !== '') {
                $owners[$seat] = $party;
            }
        }
        return $owners;
    }

    public static function leadersOf(array $board): array
    {
        $out = [];
        foreach ($board as $seat => $shares) {
            $best = null;
            $bestShare = -1.0;
            foreach ($shares as $party => $share) {
                if ((float) $share > $bestShare) {
                    $bestShare = (float) $share;
                    $best = (string) $party;
                }
            }
            if ($best !== null) {
                $out[(string) $seat] = $best;
            }
        }
        return $out;
    }
}
