import { test, expect } from '@playwright/test';

/**
 * Generate mock players for testing
 */
function generatePlayers(count: number) {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({
      name: `Player ${i + 1}`,
      alive: i % 3 !== 0, // Every 3rd player is dead
      traveler: i >= count - 2 && count > 5, // Last 2 are travelers if enough players
      ghostVote: i % 3 !== 0 && i % 2 === 0, // Some dead players have ghost votes
    });
  }
  return players;
}

async function setupMockState(page: any, data: Record<string, unknown>) {
  await page.route(/\/api\/state(?:\?.*)?$/, async (route: any) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...data, revision: 1 }),
    });
  });
}

async function setupMockPlayers(page: any, playerCount: number, phase: string = 'Night', phaseNumber: number = 1) {
  const data = { 
    players: generatePlayers(playerCount), 
    phase, 
    phaseNumber 
  };
  
  await setupMockState(page, data);
}

/**
 * Test display rendering for player counts 6-20
 */
for (let playerCount = 6; playerCount <= 20; playerCount++) {
  test(`Display renders correctly with ${playerCount} players`, async ({ page }) => {
    // Setup mock before navigation
    await setupMockPlayers(page, playerCount, 'Night', 1);
    
    // Navigate to display page
    await page.goto('display.html');
    
    // Wait for mock data to be processed
    await page.waitForTimeout(200);
    
    // Verify the phase display updated
    const phaseDisplay = page.locator('#phaseDisplay');
    await expect(phaseDisplay).toContainText('Night 1');
    
    // Verify player stats are correct
    const totalPlayers = page.locator('#totalPlayers');
    await expect(totalPlayers).toHaveText(playerCount.toString());
    
    // Verify all player cards are rendered
    const playerCards = page.locator('.player-card');
    await expect(playerCards).toHaveCount(playerCount);
    
    // Verify player names are visible
    const firstPlayer = playerCards.first();
    await expect(firstPlayer.locator('.player-name')).toContainText('Player 1');
    
    const lastPlayer = playerCards.last();
    await expect(lastPlayer.locator('.player-name')).toContainText(`Player ${playerCount}`);
    
    // Take a screenshot for visual verification
    await page.screenshot({ 
      path: `test-results/player-count-${playerCount}-players.png`,
      fullPage: false 
    });
  });
  
  // Also test in Day phase
  test(`Display renders correctly with ${playerCount} players in Day phase`, async ({ page }) => {
    await setupMockPlayers(page, playerCount, 'Day', 2);
    
    await page.goto('display.html');
    await page.waitForTimeout(200);
    
    // Verify day theme is applied (body has day-theme class)
    const body = page.locator('body');
    await expect(body).toHaveClass(/day-theme/);
    
    // Verify phase display shows Day 2
    const phaseDisplay = page.locator('#phaseDisplay');
    await expect(phaseDisplay).toContainText('Day 2');
    
    // Verify player count
    const playerCards = page.locator('.player-card');
    await expect(playerCards).toHaveCount(playerCount);
    
    // Take screenshot
    await page.screenshot({ 
      path: `test-results/player-count-${playerCount}-players-day.png`,
      fullPage: false 
    });
  });
}

/**
 * Test edge case: 6 players all alive, no travelers
 */
test('6 players - all alive, no travelers', async ({ page }) => {
  const data = {
    players: Array.from({ length: 6 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: true,
      traveler: false,
      ghostVote: false,
    })),
    phase: 'Night',
    phaseNumber: 1,
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // All players should be alive
  await expect(page.locator('#alivePlayers')).toHaveText('6');
  await expect(page.locator('#deadPlayers')).toHaveText('0');
  
  // No traveler icons
  const travelerIcons = page.locator('.status-icon');
  const count = await travelerIcons.count();
  let travelerCount = 0;
  for (let i = 0; i < count; i++) {
    const text = await travelerIcons.nth(i).textContent();
    if (text?.includes('🎒')) travelerCount++;
  }
  expect(travelerCount).toBe(0);
  
  await page.screenshot({ path: 'test-results/player-count-6-all-alive.png' });
});

/**
 * Test edge case: 20 players with mixed states
 */
test('20 players - mixed states', async ({ page }) => {
  const data = {
    players: Array.from({ length: 20 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 12, // 12 alive, 8 dead
      traveler: i >= 15, // 5 travelers (players 16-20)
      ghostVote: i >= 12 && i < 16, // 4 ghost votes
    })),
    phase: 'Day',
    phaseNumber: 3,
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify counts
  await expect(page.locator('#alivePlayers')).toHaveText('12');
  await expect(page.locator('#deadPlayers')).toHaveText('8');
  
  // Count traveler icons (🎒) only in player cards (not legend)
  const playerCards = page.locator('.player-card');
  const playerContent = await playerCards.evaluateAll(cards => cards.map(c => c.textContent).join(''));
  const travelerMatches = playerContent.match(/🎒/g);
  expect(travelerMatches?.length || 0).toBe(5);
  
  // Count ghost vote icons (👻) only in player cards
  const ghostMatches = playerContent.match(/👻/g);
  expect(ghostMatches?.length || 0).toBe(4);
  
  await page.screenshot({ path: 'test-results/player-count-20-mixed.png' });
});

/**
 * Test on-block feature: player marked for execution during day
 */
test('on-block player display and votes calculation', async ({ page }) => {
  const data = {
    players: Array.from({ length: 8 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 6, // 6 alive, 2 dead
      traveler: false,
      ghostVote: false,
    })),
    phase: 'Day',
    phaseNumber: 2,
    onBlockPlayer: 2, // Player 3 is on the block
    onBlockVotes: 5, // 5 votes on the block
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify day theme is applied
  const body = page.locator('body');
  await expect(body).toHaveClass(/day-theme/);
  
  // Verify on-block display (center widget) is hidden
  const onBlockDisplay = page.locator('#onBlockDisplay');
  await expect(onBlockDisplay).toBeHidden();
  
  // Verify on-block player card has special styling and vote count
  const playerCards = page.locator('.player-card');
  const thirdPlayerCard = playerCards.nth(2); // Player 3 (index 2)
  await expect(thirdPlayerCard).toHaveClass(/on-block/);
  
  // Verify no candle shown for on-block player
  const thirdCardContent = await thirdPlayerCard.textContent();
  expect(thirdCardContent).not.toContain('🕯️');
  
  // Verify on-block label shows votes count
  expect(thirdCardContent).toContain('5 Votes');
  
  // Votes to execute = max(half alive (6/2=3), on-block votes + 1 (5+1=6)) = 6
//there IS an on-block player (Player 3, index 2), so:
  // Votes to execute = max(3, 5+1=6) = 6
  // Display should show "Votes needed to execute: 6" since no nominated player
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute: 6');
  
  await page.screenshot({ path: 'test-results/on-block-feature.png' });
});

/**
 * Test votes-to-execute uses half alive when no player on block
 */
test('votes-to-execute defaults to half alive when no on-block player', async ({ page }) => {
  const data = {
    players: Array.from({ length: 8 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 5, // 5 alive, 3 dead
      traveler: false,
      ghostVote: false,
    })),
    phase: 'Day',
    phaseNumber: 1,
    onBlockPlayer: null, // No one on the block
    onBlockVotes: 0,
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify on-block display is hidden
  const onBlockDisplay = page.locator('#onBlockDisplay');
  await expect(onBlockDisplay).toBeHidden();
  
  // 5 alive players, half rounded up = 3
  // Display should show "Votes needed to execute: 3" below phase widget
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute: 3');
  
  await page.screenshot({ path: 'test-results/votes-no-on-block.png' });
});

/**
 * Test on-block with 15 players
 */
test('15 players with on-block player', async ({ page }) => {
  const data = {
    players: Array.from({ length: 15 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 10, // 10 alive, 5 dead
      traveler: i >= 12, // 3 travelers
      ghostVote: i >= 10 && i < 12, // 2 ghost votes
    })),
    phase: 'Day',
    phaseNumber: 3,
    onBlockPlayer: 4, // Player 5 is on the block
    onBlockVotes: 7, // 7 votes
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify day theme
  const body = page.locator('body');
  await expect(body).toHaveClass(/day-theme/);
  
  // Verify all 15 player cards rendered
  const playerCards = page.locator('.player-card');
  await expect(playerCards).toHaveCount(15);
  
  // Verify on-block player (Player 5, index 4) has special styling
  const fifthPlayerCard = playerCards.nth(4);
  await expect(fifthPlayerCard).toHaveClass(/on-block/);
  
  // Verify no candle shown for on-block player
  const fifthCardContent = await fifthPlayerCard.textContent();
  expect(fifthCardContent).not.toContain('🕯️');
  
  // Verify on-block label shows votes
  expect(fifthCardContent).toContain('7 Votes');
  
  // Votes to execute = max(half alive (10/2=5), on-block votes + 1 (7+1=8)) = 8
  // Display should show "Votes needed to execute Player 5: 8"
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute: 8');
  
  await page.screenshot({ path: 'test-results/15-players-on-block.png' });
});

/**
 * Test on-block with 20 players
 */
test('20 players with on-block player', async ({ page }) => {
  const data = {
    players: Array.from({ length: 20 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 14, // 14 alive, 6 dead
      traveler: i >= 16, // 4 travelers
      ghostVote: i >= 14 && i < 16, // 2 ghost votes
    })),
    phase: 'Day',
    phaseNumber: 4,
    onBlockPlayer: 12, // Player 13 is on the block
    onBlockVotes: 8, // 8 votes
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify day theme
  const body = page.locator('body');
  await expect(body).toHaveClass(/day-theme/);
  
  // Verify all 20 player cards rendered
  const playerCards = page.locator('.player-card');
  await expect(playerCards).toHaveCount(20);
  
  // Verify on-block player (Player 13, index 12) has special styling
  const thirteenthPlayerCard = playerCards.nth(12);
  await expect(thirteenthPlayerCard).toHaveClass(/on-block/);
  
  // Verify no candle shown for on-block player
  const thirteenthCardContent = await thirteenthPlayerCard.textContent();
  expect(thirteenthCardContent).not.toContain('🕯️');
  
  // Verify on-block label shows votes
  expect(thirteenthCardContent).toContain('8 Votes');
  
  // Votes to execute = max(half alive (14/2=7), on-block votes + 1 (8+1=9)) = 9
  // Display should show "Votes needed to execute: 9"
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute: 9');
  
  await page.screenshot({ path: 'test-results/20-players-on-block.png' });
});

/**
 * Test nominated feature with votes calculation
 */
test('nominated player with votes-to-execute calculation', async ({ page }) => {
  const data = {
    players: Array.from({ length: 10 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 8, // 8 alive, 2 dead
      traveler: false,
      ghostVote: false,
    })),
    phase: 'Day',
    phaseNumber: 2,
    onBlockPlayer: 3, // Player 4 is on the block
    onBlockVotes: 4, // 4 votes on the block
    nominatedPlayer: 5, // Player 6 is nominated
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify day theme
  const body = page.locator('body');
  await expect(body).toHaveClass(/day-theme/);
  
  // Verify nominated player (Player 6, index 5) has special styling
  const playerCards = page.locator('.player-card');
  const sixthPlayerCard = playerCards.nth(5);
  await expect(sixthPlayerCard).toHaveClass(/nominated/);
  
  // Verify nominated label is visible
  const sixthCardContent = await sixthPlayerCard.textContent();
  expect(sixthCardContent).toContain('Nominated');
  
  // Verify on-block player also has styling
  const fourthPlayerCard = playerCards.nth(3);
  await expect(fourthPlayerCard).toHaveClass(/on-block/);
  
  // Votes to execute = max(half alive (8/2=4), on-block votes + 1 (4+1=5)) = 5
  // Display should show "Votes needed to execute Player 6: 5" (nominated player) below phase widget
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute Player 6: 5');
  
  await page.screenshot({ path: 'test-results/nominated-feature.png' });
});

/**
 * Test nominated without on-block
 */
test('nominated player without on-block player', async ({ page }) => {
  const data = {
    players: Array.from({ length: 8 }, (_, i) => ({
      name: `Player ${i + 1}`,
      alive: i < 6, // 6 alive, 2 dead
      traveler: false,
      ghostVote: false,
    })),
    phase: 'Day',
    phaseNumber: 1,
    onBlockPlayer: null, // No one on the block
    onBlockVotes: 0,
    nominatedPlayer: 2, // Player 3 is nominated
  };
  
  await setupMockState(page, data);
  
  await page.goto('display.html');
  await page.waitForTimeout(200);
  
  // Verify nominated player (Player 3, index 2) has special styling
  const playerCards = page.locator('.player-card');
  const thirdPlayerCard = playerCards.nth(2);
  await expect(thirdPlayerCard).toHaveClass(/nominated/);
  
  // Votes to execute = max(half alive (6/2=3), on-block votes + 1 (0+1=1)) = 3
  // Display should show "Votes needed to execute: 3" below phase widget (nominated player)
  const votesToExecuteText = page.locator('#votesToExecuteText');
  await expect(votesToExecuteText).toHaveText('Votes needed to execute Player 3: 3');
  
  await page.screenshot({ path: 'test-results/nominated-only.png' });
});
