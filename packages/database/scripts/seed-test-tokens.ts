// Seed test tokens so the UI has data to display
// Run: npx tsx scripts/seed-test-tokens.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_TOKENS = [
  {
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    name: 'Bonk',
    symbol: 'BONK',
    tier: 'bonded',
    creatorWallet: '11111111111111111111111111111111',
  },
  {
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    name: 'dogwifhat',
    symbol: 'WIF',
    tier: 'bonded',
    creatorWallet: '11111111111111111111111111111111',
  },
  {
    address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
    name: 'Popcat',
    symbol: 'POPCAT',
    tier: 'bonded',
    creatorWallet: '11111111111111111111111111111111',
  },
  {
    address: 'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', // MOODENG
    name: 'Moo Deng',
    symbol: 'MOODENG',
    tier: 'rising',
    creatorWallet: '11111111111111111111111111111111',
  },
  {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', // SLERF
    name: 'Slerf',
    symbol: 'SLERF',
    tier: 'degen',
    creatorWallet: '11111111111111111111111111111111',
  },
];

async function seed() {
  console.log('Seeding test tokens...\n');

  for (const token of TEST_TOKENS) {
    const result = await prisma.token.upsert({
      where: { address: token.address },
      update: {
        name: token.name,
        symbol: token.symbol,
        tier: token.tier,
        isActive: true,
      },
      create: {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        tier: token.tier,
        creatorWallet: token.creatorWallet,
        isActive: true,
        totalTradingVolume: BigInt(Math.floor(Math.random() * 50_000_000_000)), // fake volume
        totalCreatorPayouts: BigInt(0),
        totalFeesClaimed: BigInt(0),
      },
    });

    console.log(`  ${result.symbol} (${result.tier}) - ${result.address.slice(0, 8)}...`);
  }

  console.log('\nDone! 5 test tokens seeded.');
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
