<?php
/**
 * Test harness: exposes the PHP campaign engine to the Node test runner so the
 * two implementations can be compared directly. Dev only, never deployed.
 *
 *   php tools/php-probe.php rng <seed> <count>
 *   php tools/php-probe.php hash <string>
 *   php tools/php-probe.php outcomes <actionId> <samples>
 *   php tools/php-probe.php play <json-payload>
 *   php tools/php-probe.php blocked <json-payload>
 *   php tools/php-probe.php loan <json-payload>
 *   php tools/php-probe.php settle <json-payload>
 *   php tools/php-probe.php events <seed> <count>
 *   php tools/php-probe.php investigate <json-payload>
 *   php tools/php-probe.php rounds
 */
declare(strict_types=1);

require __DIR__ . '/../simple/api/lib/Lobby.php';
require __DIR__ . '/../simple/api/lib/Campaign.php';
require __DIR__ . '/../simple/api/lib/Rounds.php';
require __DIR__ . '/../simple/api/lib/Coalition.php';
require __DIR__ . '/../simple/api/lib/Investigation.php';

$engine = new Campaign(__DIR__ . '/../simple/api/campaign-config.json');
$cmd = $argv[1] ?? '';

switch ($cmd) {
    case 'hash':
        echo json_encode(['hash' => Campaign::hashString($argv[2] ?? '')]);
        break;

    case 'rng': {
        $next = Campaign::seededSequence($argv[2] ?? 'seed');
        $out = [];
        $n = (int) ($argv[3] ?? 5);
        for ($i = 0; $i < $n; $i++) {
            $out[] = $next();
        }
        echo json_encode($out);
        break;
    }

    case 'outcomes': {
        // Which outcome each roll selects, across the unit interval.
        $action = $engine->action($argv[2] ?? 'rally');
        $samples = (int) ($argv[3] ?? 100);
        $out = [];
        for ($i = 0; $i < $samples; $i++) {
            $roll = $i / $samples;
            $out[] = Campaign::weightedPick($action['outcomes'], $roll)['id'];
        }
        echo json_encode($out);
        break;
    }

    case 'play': {
        $payload = json_decode($argv[2], true);
        [$player, $board, $report] = $engine->play(
            $payload['player'],
            $payload['board'],
            $payload['actionId'],
            $payload['target'],
            $payload['rolls']
        );
        echo json_encode([
            'cash' => $player['cash'],
            'spent' => $player['spent'],
            'heat' => $player['heat'],
            'granted' => $player['granted'] ?? 0,
            'raised' => $player['raised'] ?? 0,
            'seatsLed' => $engine->seatsLed($board, $player['partyId']),
            'report' => $report,
            'support' => $board,
        ]);
        break;
    }

    case 'blocked': {
        $payload = json_decode($argv[2], true);
        echo json_encode([
            'reason' => $engine->blockedReason(
                $payload['player'],
                $payload['board'],
                $payload['actionId'],
                $payload['target']
            ),
        ]);
        break;
    }

    case 'loan': {
        $payload = json_decode($argv[2], true);
        $offer = $engine->loanOffer($payload['player'], (int) $payload['amount'], (int) $payload['round']);
        echo json_encode($offer);
        break;
    }

    case 'settle': {
        $payload = json_decode($argv[2], true);
        [$player, $summary] = $engine->settleLoans(
            $payload['player'],
            (int) $payload['round'],
            ['repayments' => []]
        );
        echo json_encode([
            'cash' => $player['cash'],
            'heat' => $player['heat'],
            'defaults' => $player['defaults'] ?? 0,
            'borrowingBlocked' => !empty($player['borrowingBlocked']),
            'repayments' => $summary['repayments'],
        ]);
        break;
    }

    case 'events': {
        // Which event each roll selects, across the unit interval.
        $samples = (int) ($argv[3] ?? 100);
        $list = $engine->config()['events']['list'];
        $out = [];
        for ($i = 0; $i < $samples; $i++) {
            $out[] = Campaign::weightedPick($list, $i / $samples)['id'];
        }
        echo json_encode($out);
        break;
    }

    /**
     * Run one investigation against a player on a given amount of cash, and
     * report what it cost them. Used to cover the branch where a fine is
     * larger than the cash in hand — which needs a chosen balance, not one
     * that happens to arise from play.
     */
    case 'investigate': {
        $payload = json_decode($argv[2], true);
        $inv = new Investigation($engine);

        $accused = Lobby::newPlayer(1, $engine->startingBudget());
        // The finding is rolled from the game id and the accused's id, so both
        // are pinned to the seed. Otherwise every run samples a different set
        // of outcomes and the assertions below drift.
        $accused['id'] = 'accused';
        $accused['partyId'] = 'aap';
        $accused['cash'] = (int) $payload['cash'];
        $accused['heat'] = (float) ($payload['heat'] ?? 90);
        $accused['record']['reportsAgainst'] = ['r1' => true, 'r2' => true];
        // range(1, 0) counts downwards in PHP and would hand a "clean" player
        // two risky actions, so guard the zero case explicitly.
        $riskyCount = (int) ($payload['risky'] ?? 6);
        for ($i = 1; $i <= $riskyCount; $i++) {
            $accused['actions'][] = ['group' => 'risky', 'constituency' => $i];
        }

        $game = Lobby::newGame('TESTX');
        $game['id'] = (string) $payload['seed'];
        $game['phase'] = 'election';
        $game['turn'] = 1;
        $game['players'][$accused['id']] = $accused;
        [$board] = $engine->seedSupport(range(1, 117), Lobby::GAME_PARTIES, 'board', []);
        $game['board'] = $board;

        [$game, $record] = $inv->open($game, $accused['id']);
        $after = $game['players'][$accused['id']];

        echo json_encode([
            'outcomeId' => $record['outcomeId'],
            'fineCharged' => $record['fine'],
            'cashBefore' => (int) $payload['cash'],
            'cashAfter' => (int) $after['cash'],
            'finesPaid' => (int) ($after['finesPaid'] ?? 0),
            'restrictTurns' => $record['restrictTurns'],
            'note' => $record['note'],
        ]);
        break;
    }

    case 'budget':
        echo json_encode(['startingBudget' => $engine->startingBudget()]);
        break;

    case 'rounds':
        echo json_encode($engine->rounds());
        break;

    default:
        fwrite(STDERR, "unknown command\n");
        exit(1);
}
