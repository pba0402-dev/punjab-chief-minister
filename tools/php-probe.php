<?php
/**
 * Test harness: exposes the PHP campaign engine to the Node test runner so the
 * two implementations can be compared directly. Dev only, never deployed.
 *
 *   php tools/php-probe.php rng <seed> <count>
 *   php tools/php-probe.php hash <string>
 *   php tools/php-probe.php outcomes <actionId> <samples>
 *   php tools/php-probe.php play <json-payload>
 */
declare(strict_types=1);

require __DIR__ . '/../simple/api/lib/Campaign.php';

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
        [$player, $report] = $engine->play(
            $payload['player'],
            $payload['actionId'],
            $payload['target'],
            $payload['rolls']
        );
        echo json_encode([
            'spent' => $player['spent'],
            'heat' => $player['heat'],
            'seatsLed' => $engine->seatsLed($player),
            'report' => $report,
            'support' => $player['support'],
        ]);
        break;
    }

    case 'blocked': {
        $payload = json_decode($argv[2], true);
        echo json_encode([
            'reason' => $engine->blockedReason($payload['player'], $payload['actionId'], $payload['target']),
        ]);
        break;
    }

    case 'budget':
        echo json_encode(['startingBudget' => $engine->startingBudget()]);
        break;

    default:
        fwrite(STDERR, "unknown command\n");
        exit(1);
}
