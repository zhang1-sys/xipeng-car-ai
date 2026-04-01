const baseUrl = process.env.CONFIGURATOR_BASE_URL || "http://127.0.0.1:3001";
const endpoint = `${baseUrl}/api/configurator`;

const prompts = {
  want: "\u6211\u60f3\u914d\u7f6e ",
  pickVariant: "\u9009 ",
  pickColor: "\u5916\u89c2\u9009 ",
  pickInterior: "\u5185\u9970\u9009 ",
  skipPackage: "\u5148\u4e0d\u52a0\u88c5\uff0c\u76f4\u63a5\u51fa\u914d\u7f6e\u5355",
  directSummary: "\u76f4\u63a5\u51fa\u914d\u7f6e\u5355",
};

const scenarios = [
  { label: "G6", prompt: "G6", expectInteriors: true, expectPackages: true },
  { label: "G9", prompt: "G9", expectInteriors: true, expectPackages: true },
  { label: "X9", prompt: "X9", expectInteriors: true, expectPackages: false },
  { label: "MONA M03", prompt: "MONA M03", expectInteriors: false, expectPackages: true },
  { label: "G7", prompt: "G7", expectInteriors: true, expectPackages: true },
  { label: "P7+", prompt: "P7+", expectInteriors: true, expectPackages: true },
  { label: "P7", prompt: "\u5168\u65b0\u5c0f\u9e4f P7", expectInteriors: true, expectPackages: false },
];

async function turn(sessionId, message) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ message, sessionId }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function pickFirst(options) {
  return Array.isArray(options) && options.length ? options[0] : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function selectedModelName(payload) {
  return payload.configState?.selectedModel || payload.configState?.model || null;
}

function selectedVariantName(payload) {
  return payload.configState?.selectedVariant || payload.configState?.variant || null;
}

function selectedColorName(payload) {
  return payload.configState?.selectedColor || payload.configState?.exteriorColor || null;
}

function selectedInteriorName(payload) {
  return payload.configState?.selectedInterior || payload.configState?.interiorColor || null;
}

async function runScenario(scenario) {
  const steps = [];

  let payload = await turn(null, prompts.want + scenario.prompt);
  const sessionId = payload.sessionId;
  steps.push({
    step: "model",
    stage: payload.stage,
    variants: payload.choices?.variants?.length || 0,
    colors: payload.choices?.colors?.length || 0,
    interiors: payload.choices?.interiors?.length || 0,
    packages: payload.choices?.packages?.length || 0,
    selectedModel: selectedModelName(payload),
  });

  assert(selectedModelName(payload), `${scenario.label}: model was not selected`);
  assert((payload.choices?.variants?.length || 0) > 0, `${scenario.label}: variants missing`);

  const variant = pickFirst(payload.choices?.variants)?.name;
  assert(variant, `${scenario.label}: no selectable variant`);

  payload = await turn(sessionId, prompts.pickVariant + variant);
  steps.push({
    step: "variant",
    stage: payload.stage,
    colors: payload.choices?.colors?.length || 0,
    interiors: payload.choices?.interiors?.length || 0,
    packages: payload.choices?.packages?.length || 0,
    selectedVariant: selectedVariantName(payload),
  });

  assert(selectedVariantName(payload), `${scenario.label}: variant was not selected`);
  assert((payload.choices?.colors?.length || 0) > 0, `${scenario.label}: colors missing`);

  const color = pickFirst(payload.choices?.colors)?.name;
  assert(color, `${scenario.label}: no selectable color`);

  payload = await turn(sessionId, prompts.pickColor + color);
  steps.push({
    step: "color",
    stage: payload.stage,
    interiors: payload.choices?.interiors?.length || 0,
    packages: payload.choices?.packages?.length || 0,
    selectedColor: selectedColorName(payload),
  });

  assert(selectedColorName(payload), `${scenario.label}: color was not selected`);

  const interiorsCount = payload.choices?.interiors?.length || 0;
  const packagesCount = payload.choices?.packages?.length || 0;
  assert(
    scenario.expectInteriors ? interiorsCount > 0 : interiorsCount === 0,
    `${scenario.label}: unexpected interiors count ${interiorsCount}`
  );
  assert(
    scenario.expectPackages ? packagesCount > 0 : packagesCount === 0,
    `${scenario.label}: unexpected packages count ${packagesCount}`
  );

  if (scenario.expectInteriors) {
    const interior = pickFirst(payload.choices?.interiors)?.name;
    assert(interior, `${scenario.label}: no selectable interior`);
    payload = await turn(sessionId, prompts.pickInterior + interior);
    steps.push({
      step: "interior",
      stage: payload.stage,
      packages: payload.choices?.packages?.length || 0,
      selectedInterior: selectedInteriorName(payload),
    });
    assert(selectedInteriorName(payload), `${scenario.label}: interior was not selected`);
  }

  if (scenario.expectPackages) {
    payload = await turn(sessionId, prompts.skipPackage);
    steps.push({
      step: "package_skip",
      stage: payload.stage,
      done: Boolean(payload.configState?.done || payload.configSummary),
    });
  } else {
    payload = await turn(sessionId, prompts.directSummary);
    steps.push({
      step: "summary_direct",
      stage: payload.stage,
      done: Boolean(payload.configState?.done || payload.configSummary),
    });
  }

  assert(
    Boolean(payload.configSummary || payload.configState?.summary_text || payload.configState?.done),
    `${scenario.label}: summary was not produced`
  );

  return {
    label: scenario.label,
    ok: true,
    finalStage: payload.stage,
    steps,
  };
}

async function main() {
  const results = [];

  for (const scenario of scenarios) {
    try {
      results.push(await runScenario(scenario));
    } catch (error) {
      results.push({
        label: scenario.label,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failures = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ ok: failures.length === 0, endpoint, results }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
