import { test, expect, type Page } from "@playwright/test";

// Typing before React hydrates is lost: the saved name from another tab replaces it.
async function openParty(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

async function createTabRoom(page: Page, name: string) {
  await openParty(page, "/?mode=tabs");
  await page.getByLabel("What should we call you?").fill(name);
  await page.getByRole("button", { name: "Create a party" }).click();
  await expect(page.getByRole("heading", { name: "The gang" })).toBeVisible();
  return (await page.locator(".room-code").innerText()).trim();
}

// Ready-up requires passing one sample mic test first.
async function readyUp(page: Page) {
  await page.getByRole("button", { name: "Mic check & ready up" }).click();
  await expect(page.locator(".mic-orb.passed")).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(
    page.getByRole("button", { name: "Ready · Change my mind" }),
  ).toBeVisible();
}

async function joinTabRoom(page: Page, code: string, name: string) {
  await openParty(page, `/?mode=tabs&room=${code}`);
  await page.getByLabel("What should we call you?").fill(name);
  await page.getByRole("button", { name: "Join party", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The gang" })).toBeVisible();
}

test("complete two-player, two-round match using real browser recording and local blob transfer", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const code = await createTabRoom(page, "Anu");
  await page.getByLabel("Rounds", { exact: true }).selectOption("2");
  const friend = await context.newPage();
  friend.on("pageerror", (error) => errors.push(error.message));
  await joinTabRoom(friend, code, "Manu");
  await readyUp(page);
  await readyUp(friend);
  await expect(
    page.getByRole("button", { name: "Start the chaos" }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".taste-skill/lobby-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start the chaos" }).click();
  for (let round = 1; round <= 2; round++) {
    await expect(page.locator(".prompt-headline")).toContainText(
      "Get ready for",
      { timeout: 35000 },
    );
    await expect(page.locator(".count-in")).toBeVisible();
    await expect(page.locator(".lyrics")).toBeVisible();
    await expect(page.locator(".prompt-subline")).toHaveText(
      /Your recording stops after [\d.]+s\./,
    );
    // Takes can be under a second, so check every animation frame rather than every poll.
    for (const player of [page, friend])
      await player.waitForFunction(
        () => document.querySelector(".recording-panel") !== null,
        null,
        { timeout: 10000 },
      );
    await expect(page.locator(".phase-label")).toHaveText(
      "Your gang, on stage",
      { timeout: 30000 },
    );
    await expect(page.locator(".playback-screen")).toContainText(
      "Performance 1 of 2",
    );
    if (round === 1) {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1107, height: 1172 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator(".game-panel .reaction-bar")).toHaveCount(1);
        const waveform = await page.locator(".voice-shape").boundingBox();
        const reactions = await page.locator(".game-panel .reaction-bar").boundingBox();
        expect(reactions!.y - (waveform!.y + waveform!.height)).toBeGreaterThanOrEqual(-1);
        expect(reactions!.y - (waveform!.y + waveform!.height)).toBeLessThanOrEqual(12);
        await page.screenshot({ path: ".taste-skill/round-layout-" + viewport.width + ".png", fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await expect(page.locator(".phase-label")).toHaveText("The scores are in", {
      timeout: 30000,
    });
    await expect(page.locator(".score-row")).toHaveCount(2);
    await expect(page.locator(".score-row").first()).not.toContainText(
      "No take received",
    );
    await expect(page.locator(".score-row").first()).toContainText("/100");
  }
  await expect(page.locator(".results")).toBeVisible({ timeout: 20000 });
  await expect(friend.locator(".results")).toBeVisible();
  await expect(page.locator(".leaderboard li")).toHaveCount(2);
  expect(await page.locator(".leaderboard").innerText()).toBe(
    await friend.locator(".leaderboard").innerText(),
  );
  await page.screenshot({
    path: ".taste-skill/results-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "One more party" }).click();
  await expect(
    page.getByRole("button", { name: "Mic check & ready up" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("host loss recovers to a lobby without deadlock", async ({
  page,
  context,
}) => {
  const code = await createTabRoom(page, "Host");
  const friend = await context.newPage();
  await joinTabRoom(friend, code, "Friend");
  await expect(page.locator(".player-list")).toContainText("Friend");
  await page.close();
  await expect(friend.locator(".notice")).toContainText("Host left", {
    timeout: 22000,
  });
  await expect(
    friend.getByRole("button", { name: "Start the chaos" }),
  ).toBeVisible();
});

test("invalid room, denied microphone and honest online configuration state", async ({
  page,
}) => {
  await openParty(page, "/?mode=tabs");
  await page.getByLabel("What should we call you?").fill("Anu");
  await page.getByLabel("8-character room code").fill("ZZZZZZZZ");
  await page.getByRole("button", { name: "Join party", exact: true }).click();
  await expect(page.locator(".alert")).toContainText("Room not found");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "Audio and display settings" }).click();
  await page.getByRole("button", { name: "Enable microphone" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "denied",
  );
});

test("desktop, tablet and phone layout, library and settings", async ({
  page,
}) => {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.taste-skill/home-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Audio and display settings" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
  }
});

test("a failed audio upload does not deadlock the round", async ({
  page,
  context,
}) => {
  const code = await createTabRoom(page, "Anu");
  await page.getByLabel("Rounds", { exact: true }).selectOption("2");
  const friend = await context.newPage();
  await joinTabRoom(friend, code, "Manu");
  await readyUp(page);
  await readyUp(friend);
  await friend.evaluate(() => {
    indexedDB.open = () => {
      throw new Error("Simulated storage failure");
    };
  });
  await page.getByRole("button", { name: "Start the chaos" }).click();
  await expect(page.locator(".phase-label")).toHaveText("The scores are in", {
    timeout: 60000,
  });
  await expect(
    page.locator(".score-row").filter({ hasText: "Manu" }),
  ).toContainText("Simulated storage failure");
  await expect(
    page
      .locator(".score-row")
      .filter({ has: page.getByText("Anu", { exact: true }) }),
  ).not.toContainText("No take received");
});

test("a connected player who never submits is skipped at the deadline", async ({
  page,
  context,
}) => {
  const code = await createTabRoom(page, "Anu");
  await page.getByLabel("Rounds", { exact: true }).selectOption("2");
  const friend = await context.newPage();
  await joinTabRoom(friend, code, "Manu");
  await readyUp(page);
  await readyUp(friend);
  await friend.evaluate(() => {
    MediaRecorder.prototype.start = function () {};
  });
  await page.getByRole("button", { name: "Start the chaos" }).click();
  await expect(page.locator(".phase-label")).toHaveText("The scores are in", {
    timeout: 60000,
  });
  await expect(
    page.locator(".score-row").filter({ hasText: "Manu" }),
  ).toContainText("No take received before the deadline");
  await expect(
    page
      .locator(".score-row")
      .filter({ has: page.getByText("Anu", { exact: true }) }),
  ).not.toContainText("No take received");
});

test("host adds a private room clip that both players hear and imitate", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const code = await createTabRoom(page, "Anu");
  await page.getByRole("button", { name: /Your clips/ }).click();
  await expect(page.locator(".custom-clips")).toContainText(
    "Add at least one clip",
  );
  await page.getByLabel("Audio file").setInputFiles("tests/fixtures/fake-mic.wav");
  await page.getByLabel("What should players say?").fill("Pattiyude kura");
  await expect(page.getByRole("button", { name: "Add clip" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Add clip" }).click();
  await expect(page.locator(".custom-clips .sound-row")).toContainText(
    "Pattiyude kura",
  );
  await page.getByLabel("Rounds", { exact: true }).selectOption("2");
  const friend = await context.newPage();
  friend.on("pageerror", (error) => errors.push(error.message));
  await joinTabRoom(friend, code, "Manu");
  await expect(friend.locator(".custom-clips .sound-row")).toContainText(
    "Pattiyude kura",
  );
  await expect(friend.getByLabel("Audio file")).toHaveCount(0);
  await readyUp(page);
  await readyUp(friend);
  await page.getByRole("button", { name: "Start the chaos" }).click();
  await expect(friend.locator(".prompt-screen")).toContainText("Pattiyude kura", {
    timeout: 15000,
  });
  await expect(friend.locator(".prompt-screen")).toContainText(
    "host’s private clip",
  );
  await expect(page.locator(".phase-label")).toHaveText("The scores are in", {
    timeout: 60000,
  });
  for (const row of await page.locator(".score-row").all())
    await expect(row).toContainText(/\d+\s*\/100/);
  expect(errors).toEqual([]);
});

test("performers take the mic one by one while the crowd reacts, throws tomatoes and sees each score", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const code = await createTabRoom(page, "Anu");
  await page.getByLabel("Rounds", { exact: true }).selectOption("2");
  const friend = await context.newPage();
  friend.on("pageerror", (error) => errors.push(error.message));
  await joinTabRoom(friend, code, "Manu");
  await friend.getByRole("button", { name: "Dance" }).click();
  await readyUp(page);
  await readyUp(friend);
  await page.getByRole("button", { name: "Start the chaos" }).click();

  await expect(friend.locator(".playback-screen h2")).toHaveText("Anu", { timeout: 40000 });
  await expect(friend.locator(".performance-status")).toContainText("Performing", { timeout: 5000 });
  // About three tomatoes in ten are dodged and don't count, so keep throwing until one lands.
  await expect(async () => {
    await friend.getByRole("button", { name: "Tomato" }).click();
    await expect(friend.locator(".crowd-count")).toContainText("🍅 1", { timeout: 700 });
  }).toPass({ timeout: 6000 });
  await friend.waitForTimeout(700);
  await friend.getByRole("button", { name: "Send Laugh emote" }).click();
  await expect(page.locator(".crowd-count")).toContainText("😂 1 · 🍅 1");
  await expect(friend.locator(".crowd-count")).toContainText("😂 1 · 🍅 1");
  await expect(page.locator(".score-reveal")).toContainText(/\d+\s*\/100/, { timeout: 10000 });
  await page.locator(".score-reveal summary").click();
  await expect(page.locator(".score-reveal .feature-bars li").first()).toBeVisible();
  await expect(page.locator(".phase-label")).toHaveText("Your gang, on stage");

  await expect(page.locator(".playback-screen h2")).toHaveText("Manu", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "Tomato" })).toBeVisible();
  await expect(friend.getByRole("button", { name: "Tomato" })).toBeVisible();

  await expect(page.locator(".phase-label")).toHaveText("The scores are in", { timeout: 30000 });
  await expect(page.locator(".phase-label")).toHaveText("Catch your breath", { timeout: 10000 });

  await expect(page.locator(".results")).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".awards")).toContainText("Tomato magnet: Anu · 1 tomatoes");
  await expect(page.locator(".awards")).toContainText("Crowd favourite: Anu · 1 laughs");
  expect(errors).toEqual([]);
});

test("ready-up requires passing the mic check; a silent mic fails", async ({
  page,
  context,
}) => {
  const code = await createTabRoom(page, "Anu");
  const friend = await context.newPage();
  await joinTabRoom(friend, code, "Manu");
  await readyUp(friend);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () =>
      new AudioContext().createMediaStreamDestination().stream;
  });
  await page.getByRole("button", { name: "Mic check & ready up" }).click();
  await expect(page.getByRole("dialog")).toContainText("Mic check");
  await expect(page.locator(".mic-orb.failed")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Start the chaos" })).toBeDisabled();
});

test("an invitation link puts joining first, with no scrolling on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openParty(page, "/?mode=tabs&room=ABCDEFGH");
  await expect(page.locator("#entry-title")).toContainText("invited to room ABCDEFGH");
  const join = page.getByRole("button", { name: "Join party", exact: true });
  await expect(join).toHaveClass(/primary/);
  await expect(page.getByLabel("8-character room code")).toHaveValue("ABCDEFGH");
  const box = await join.boundingBox();
  expect(box && box.y + box.height <= 844).toBe(true);
  await expect(page.getByRole("button", { name: /Try the microphone first/ })).toHaveCount(0);
});
