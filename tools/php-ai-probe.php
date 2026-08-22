<?php
/**
 * Test harness: plays whole games of one human against three AI opponents and
 * prints the outcomes as JSON, so tools/balance-ai.mjs can report on them.
 * Dev only, never deployed.
 *
 *   php tools/php-ai-probe.php [games]
 */
declare(strict_types=1);

$base = __DIR__ . '/../simple/api';
foreach (['Store', 'Code', 'Territory', 'Alliances', 'Lobby', 'Campaign', 'Rounds', 'AI', 'Investigation', 'Election', 'Coalition'] as $class) {
    require $base . '/lib/' . $class . '.php';
}

$engine = new Campaign($base . '/campaign-config.json');
$election = new Election($engine);
$games = (int) ($argv[1] ?? 20);

/*
 * How the human baseline plays.
 *
 *   naive  — safe actions only, never borrows. What an attentive but cautious
 *            player does, and the floor the opponents should clear.
 *   steady — the same decision code the opponents use, on the mildest profile.
 *            If the opponents beat this too, they have an edge that is not
 *            temperament, and that would be a bug.
 */
$mode = $argv[2] ?? 'naive';

/* The real sitting members, so the opening board is the one players see. */

$out = [];

for ($n = 0; $n < $games; $n++) {
    // Four games share one board, with the human occupying each party in
    // turn. Comparing a party played by a human against the same party played
    // by an opponent only means something on the same starting map — the
    // seeded boards vary far too widely to average out otherwise.
    $game = Lobby::newGame('AITST');

    /*
     * Four games share one seed, with the human sitting in each chair in turn.
     *
     * The board is empty for all four, so the chairs are interchangeable in a
     * way they were not when the map was dealt — but rotating still matters,
     * because who moves in which order is not.
     */
    $seats = 4;
    $game['id'] = 'ai-balance-' . intdiv($n, $seats);
    $humanSlot = ($n % $seats) + 1;

    $human = Lobby::newPlayer($humanSlot, $engine->startingBudget());
    $human['candidateName'] = 'Human';
    $human['party'] = Lobby::makeParty($humanSlot, [
        'name' => 'Human Campaign',
        'short' => 'HUM',
        'symbol' => 'star',
        'colourId' => 'slate',
    ]);
    $human['slogan'] = 'Test';
    $human['ready'] = true;
    $game['players'][$human['id']] = $human;
    $game['hostId'] = $human['id'];
    $humanId = $human['id'];
    $humanParty = $human['partyId'];
    $game['phase'] = 'election';

    // Every one of the 117 starts holding nothing at all.
    $board = $engine->emptyBoard(range(1, 117));
    $game['board'] = $board;

    foreach (Lobby::freeSlots($game) as $slot) {
        $ai = AI::newPlayer($slot, $game['id'], $engine, Lobby::claimed($game));
        $game['players'][$ai['id']] = $ai;
    }
    foreach ($game['players'] as $pid => $p) {
        $game['players'][$pid]['seatsLed'] = $engine->seatsLed($board, (string) $p['partyId']);
    }
    $game['leaders'] = Rounds::currentLeaders($board);
    $game = Rounds::begin($game, 1, $engine);

    $rand = Campaign::seededSequence('human:' . $n);

    // 'peer' marks the human as an opponent so it moves in the same phase as
    // the others. If the edge vanishes, the cause is when moves land, not how
    // they are chosen.
    if ($mode === 'peer') {
        $game['players'][$humanId]['isAI'] = true;
        $game['players'][$humanId]['profileId'] = 'steady';
    }

    for ($round = 1; $round <= 15; $round++) {
        if ($mode === 'peer') {
            $game['roundEndsAt'] = time() - 1;
            $game = Rounds::advanceIfDue($game, $engine, $election);
            $game['nextRoundAt'] = time() - 1;
            $game = Rounds::advanceIfDue($game, $engine, $election);
            if (($game['phase'] ?? '') !== 'election') {
                break;
            }
            continue;
        }

        if ($mode === 'steady') {
            // Play the human with the opponents' own decision code, so the
            // only difference left between the four seats at the table is the
            // seeded board and the dice.
            $player = $game['players'][$humanId];
            $player['profileId'] = 'steady';
            [$player, $b] = AI::takeRound(
                $player,
                Rounds::boardOf($game),
                $engine,
                $game['id'] . ':human',
                $round
            );
            $game['players'][$humanId] = $player;
            $game['board'] = $b;

            $game['roundEndsAt'] = time() - 1;
            $game = Rounds::advanceIfDue($game, $engine, $election);
            $game['nextRoundAt'] = time() - 1;
            $game = Rounds::advanceIfDue($game, $engine, $election);
            if (($game['phase'] ?? '') !== 'election') {
                break;
            }
            continue;
        }

        /*
         * A reasonable human: safe moves, aimed where they are worth most,
         * until the money runs out.
         *
         * Three a round was right when a round's allowance bought three
         * moves. It buys five now, and a baseline that stopped at three would
         * be measuring its own restraint rather than the opponents.
         */
        for ($move = 0; $move < 40; $move++) {
            $player = $game['players'][$humanId];
            $b = Rounds::boardOf($game);

            /*
             * Where a move is worth most, best first.
             *
             * An empty seat comes top: a move there wins one outright rather
             * than narrowing a gap. Then the seats this campaign is behind in,
             * closest first, because those are the cheapest to flip. Seats
             * already led come last. The margin alone cannot tell the last two
             * apart — forty ahead and forty behind are the same distance and
             * completely different decisions.
             */
            $value = [];
            foreach ($b as $key => $seat) {
                $shares = Campaign::shares((array) $seat);
                if ($shares === []) {
                    $value[(string) $key] = -1.0;
                    continue;
                }
                $mine = (float) ($shares[$humanParty] ?? 0);
                $best = 0.0;
                foreach ($shares as $pid => $v) {
                    if ($pid !== $humanParty && $v > $best) {
                        $best = (float) $v;
                    }
                }
                $margin = abs($mine - $best);
                $value[(string) $key] = $mine > $best ? 1000 + $margin : $margin;
            }
            asort($value);
            $target = (string) array_key_first($value);

            // Whatever safe action is affordable right now. A baseline that
            // downed tools the moment its first choice was out of reach would
            // be measuring its own stubbornness, not the opponents.
            $safe = array_values(array_filter(
                $engine->actions(),
                static fn($a) => ($a['group'] ?? '') === 'safe'
                    && $engine->blockedReason($player, $b, $a['id'], $target) === null
            ));
            if (!$safe) {
                break;
            }
            $action = $safe[(int) floor($rand() * count($safe)) % count($safe)];
            $rolls = Campaign::rollsFor($game['id'] . ':' . $humanId, (int) $player['rollCount']);
            $player['rollCount']++;
            [$player, $b] = $engine->play($player, $b, $action['id'], $target, $rolls);
            $game['players'][$humanId] = $player;
            $game['board'] = $b;
        }

        $game['roundEndsAt'] = time() - 1;
        $game = Rounds::advanceIfDue($game, $engine, $election);
        $game['nextRoundAt'] = time() - 1;
        $game = Rounds::advanceIfDue($game, $engine, $election);

        if (($game['phase'] ?? '') !== 'election') {
            break;
        }
    }

    $result = $game['result'] ?? $election->run($game);
    $standings = [];
    $otherSeats = 0;
    foreach ($result['standings'] as $row) {
        if ($row['party'] === 'oth') {
            $otherSeats = (int) $row['seats'];
            continue;
        }
        $player = null;
        foreach ($game['players'] as $p) {
            if (($p['partyId'] ?? '') === $row['party']) {
                $player = $p;
            }
        }
        $standings[] = [
            'party' => $row['party'],
            'isHuman' => $row['party'] === $humanParty,
            'humanParty' => $humanParty,
            'seats' => (int) $row['seats'],
            'isAI' => !empty($player['isAI']),
            'profile' => $player['profileId'] ?? null,
            'heat' => (float) ($player['heat'] ?? 0),
            'spent' => (int) ($player['spent'] ?? 0),
            'borrowed' => (int) ($player['borrowed'] ?? 0),
            'defaults' => (int) ($player['defaults'] ?? 0),
        ];
    }

    $out[] = [
        'outcome' => $result['outcome'],
        'majority' => (int) $result['majority'],
        'otherSeats' => $otherSeats,
        'standings' => $standings,
    ];
}

echo json_encode($out);
