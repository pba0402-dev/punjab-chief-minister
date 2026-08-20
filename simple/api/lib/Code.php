<?php
/**
 * Game codes.
 * ------------------------------------------------------------------
 * Five characters, readable aloud over a phone, and never derived from a
 * database id.
 *
 * The alphabet drops characters people confuse: 0/O, 1/I/L, 5/S, 8/B, and
 * 6/G. That leaves 25 symbols, so a code is 25^5 ≈ 9.7 million possibilities,
 * drawn from random_int — not a sequence, so one code tells you nothing about
 * another and they cannot be walked in order.
 *
 * Input is normalised by case and punctuation only. Characters outside the
 * alphabet are rejected rather than folded onto look-alikes: folding a typo
 * could quietly land someone in a stranger's game, which is far worse than
 * telling them the code is wrong.
 */
declare(strict_types=1);

final class Code
{
    public const ALPHABET = '23479ACDEFGHJKMNPQRTUVWXY';
    public const LENGTH = 5;

    public static function generate(): string
    {
        $alphabet = self::ALPHABET;
        $max = strlen($alphabet) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }
        return $code;
    }

    /**
     * A code no active game is using. Bounded attempts so a full table can
     * never spin forever.
     */
    public static function generateUnique(FileStore $store, int $attempts = 40): string
    {
        for ($i = 0; $i < $attempts; $i++) {
            $code = self::generate();
            if (!$store->codeExists($code)) {
                return $code;
            }
        }
        throw new RuntimeException('Could not allocate a free game code.');
    }

    /** Uppercase, strip spaces/dashes. Does not correct characters. */
    public static function normalise(string $input): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $input) ?? '');
    }

    public static function isWellFormed(string $code): bool
    {
        return strlen($code) === self::LENGTH
            && strspn($code, self::ALPHABET) === self::LENGTH;
    }
}
