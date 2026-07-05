#!/usr/bin/env node

// ============================================================================
// Follow Builders — Deterministic Briefing Generator
// ============================================================================
// Turns prepare-digest.js JSON into a structured Chinese briefing suitable for
// scheduled email delivery in non-persistent environments, where no LLM is
// available to remix the feed at cron time.
//
// Usage:
//   node prepare-digest.js | node generate-briefing.js | node deliver.js
//   node generate-briefing.js --file /path/to/prepared.json
// ============================================================================

import { readFile } from 'fs/promises';

const MAX_ITEMS = 5;

async function readInput() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return readFile(args[fileIdx + 1], 'utf8');
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function stripHtml(text = '') {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function sentenceFrom(text, terms, fallback = '') {
  const cleaned = stripHtml(text);
  const sentences = cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.find((sentence) => includesAny(sentence, terms)) || fallback || sentences[0] || '';
}

function podcastTranscript(data) {
  return data.podcasts?.[0]?.transcript || '';
}

function firstPodcast(data) {
  return data.podcasts?.[0] || null;
}

function findBlog(data, terms) {
  return (data.blogs || []).find((blog) => includesAny(`${blog.title} ${blog.content}`, terms));
}

function findBuilder(data, terms) {
  return (data.x || []).find((builder) =>
    includesAny(`${builder.name} ${builder.bio} ${(builder.tweets || []).map((tweet) => tweet.text).join(' ')}`, terms)
  );
}

function findBuilderByNameOrHandle(data, namesOrHandles) {
  const wanted = namesOrHandles.map((value) => value.toLowerCase());
  return (data.x || []).find((builder) =>
    wanted.includes((builder.name || '').toLowerCase()) ||
    wanted.includes((builder.handle || '').toLowerCase())
  );
}

function tweetUrls(builder, limit = 2) {
  return (builder?.tweets || [])
    .filter((tweet) => tweet.url)
    .slice(0, limit)
    .map((tweet) => tweet.url);
}

function addSources(lines, urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return lines;
  return [...lines, '来源：', ...unique];
}

function buildInsights(data) {
  const insights = [];
  const podcast = firstPodcast(data);
  const transcript = podcastTranscript(data);

  if (podcast && includesAny(transcript, ['bot traffic', 'human traffic', "bots don't click", 'business model'])) {
    insights.push({
      category: 'Agent / 产品趋势 / 大厂动态',
      title: 'Cloudflare：AI Agent / Bot 流量已经超过人类流量，互联网商业模式被迫重写',
      what: 'Cloudflare CEO Matthew Prince 在 The MAD Podcast 中提到，2026 年上半年 bot 流量已经超过人类流量；他预计未来五年，互联网可能出现远高于今天的自动化访问量。问题在于，过去 28 年互联网主要靠广告和订阅变现，但 bot 不会点击广告。',
      why: '这意味着网页、内容、搜索、品牌曝光和流量分发的底层逻辑正在变化。以前产品经理关心 PV、UV、点击率；Agent 时代可能更要关心机器是否能理解、调用、完成任务，以及谁为这次访问付费。',
      lesson: '产品：为 Agent 提供结构化、可读取、可授权的数据入口。技术：关注 robots、API、权限、内容计费、反爬与友好爬取的平衡。职业：理解 Agentic Internet 会成为产品/平台岗位的重要谈资。',
      source: [podcast.url],
      themes: ['Agent', '产品趋势', '大厂动态']
    });
  }

  if (podcast && includesAny(transcript, ['AI gateway', 'workers', 'model routing', 'guardrails', 'prompt'])) {
    insights.push({
      category: 'Agent / 模型基础设施 / 大厂动态',
      title: 'Cloudflare 从 CDN/安全公司变成 AI 基础设施公司：Workers、AI Gateway、边缘推理成为关键栈',
      what: 'Podcast 里系统讨论了 Cloudflare Workers、AI Gateway、边缘 GPU 推理、模型路由、prompt 审计、成本控制等能力。AI Gateway 可以记录和审计 prompt/response，插入企业级 guardrails，并根据任务复杂度选择合适模型。',
      why: 'AI 应用真正上线后，难点不只是接一个模型 API，而是如何管控成本、延迟、安全、合规和模型选择。AI Gateway 正在成为企业 AI 应用的中间控制层。',
      lesson: '产品：很多 B2B AI 产品机会会出现在治理层，而不是模型层。技术：学习 API gateway、observability、model routing、rate limit、token cost。职业：面试中可以强调自己理解从 demo 到 production 的差距。',
      source: [podcast.url],
      themes: ['Agent', '大厂动态', '创业公司 / 工具']
    });
  }

  if (podcast && includesAny(transcript, ['Log4j', 'vulnerab', 'security', 'configuration', 'review'])) {
    insights.push({
      category: 'Agent / 安全 / 产品趋势',
      title: 'Agent 安全进入高压期：AI 会更快发现漏洞，也会推动软件质量提升',
      what: 'Matthew Prince 认为未来两年可能频繁出现类似 Log4j 的高危漏洞，因为 AI 模型非常擅长发现代码漏洞。他也提到 Cloudflare 内部使用 Agent 审查代码发布和配置变更，并从多年事故数据中学习，帮助降低事故背景噪音。',
      why: 'AI 让攻击者和防守者同时增强。短期看，漏洞发现和攻击会更快；长期看，自动审查、自动测试、自动合规检查会推动软件整体质量提升。',
      lesson: '产品：安全审计、配置审查、自动化测试会成为 AI Agent 的高价值落地点。技术：关注 secure coding、CI/CD 中的 AI review、权限边界。职业：懂测试、审查和安全，比只会生成代码更重要。',
      source: [podcast.url],
      themes: ['Agent', '产品趋势']
    });
  }

  const claudeApple = findBlog(data, ['Foundation Models framework', 'Apple', 'Swift', 'on-device']);
  if (claudeApple?.url) {
    insights.push({
      category: '模型 / 大厂动态 / 产品趋势',
      title: 'Claude 接入 Apple Foundation Models framework：移动端 AI 走向“本地小模型 + 云端大模型”混合架构',
      what: 'Claude Blog 发布 Swift package，让 Apple 开发者可以通过 Apple Foundation Models framework 调用 Claude。开发者可以先用 Apple 本地模型做快速总结、抽取，再把复杂推理、代码生成、联网搜索、数据分析交给 Claude，并在 SwiftUI 中流式返回结果。',
      why: '这代表移动端 AI 产品不再只有全部上云或全部本地两种选择，而是根据任务复杂度、隐私、成本和延迟选择最合适的模型。',
      lesson: '产品：把任务拆成本地轻任务和云端重任务。技术：关注 structured output、tool calls、streaming、SwiftUI 集成。职业：对于想做应用开发的人，这是很好的简历项目方向。',
      source: [claudeApple.url],
      themes: ['模型', '大厂动态', '产品趋势']
    });
  }

  const rauch = findBuilderByNameOrHandle(data, ['Guillermo Rauch', 'rauchg']);
  const catWu = findBuilderByNameOrHandle(data, ['Cat Wu', '_catwu']);
  const signalUrls = [...tweetUrls(rauch, 1), ...tweetUrls(catWu, 1)];
  if (signalUrls.length) {
    insights.push({
      category: '模型 / 开源 / 创业公司与工具 / 产品趋势',
      title: 'Builder 社区信号：Vercel AI Gateway 显示 Anthropic 使用强势、open-weight AI 上升；Claude Fable 5 的“判断力”被开发者关注',
      what: 'Vercel CEO Guillermo Rauch 分享其 AI Gateway 聚合了来自数百万开发者、万亿级 token 的使用数据，并观察到 Anthropic 的强势和 open-weight AI 的上升。Anthropic 的 Cat Wu 也提到 Claude Fable 5 能在留存分析中主动选择 propensity score matching，显示模型不只是执行指令，而是在做方法判断。',
      why: 'builder 关注点正在从哪个模型最聪明，转向哪个模型在真实任务里判断更稳、成本更可控、生态更容易集成。open-weight 模型的上升也说明企业和开发者在寻找更灵活、更可控的方案。',
      lesson: '产品：未来 AI 产品的差异化可能来自 workflow、数据闭环和评估，而不是单纯换模型。技术：了解 open-weight、model eval、token analytics。职业：面试中可以说自己关注模型能力、成本和业务效果的平衡。',
      source: signalUrls,
      themes: ['模型', '开源', '创业公司 / 工具', '产品趋势']
    });
  }

  const codex = findBuilder(data, ['Codex', 'ChatGPT', 'can\'t do well']);
  if (insights.length < MAX_ITEMS && codex) {
    insights.push({
      category: '创业公司 / 工具 / 产品趋势',
      title: 'Codex 团队公开征集产品短板：AI coding 进入真实工作流打磨阶段',
      what: 'OpenAI Codex & ChatGPT 的 Thibault Sottiaux 公开询问 Codex 现在还有哪些早该做好但仍然做不好的地方。这类问题把注意力从 demo 转向真实开发流里的高频摩擦。',
      why: '成熟 AI coding 产品的关键不只是生成代码，而是可靠性、上下文理解、工具调用、权限边界和失败恢复。',
      lesson: '产品：高质量用户反馈本身就是路线图燃料。技术：要能识别和修复 agent 在复杂工程环境里的失败模式。职业：会清楚描述 AI 工具失败模式的人，比只会说 AI 很强的人更有价值。',
      source: tweetUrls(codex, 2),
      themes: ['创业公司 / 工具', '产品趋势']
    });
  }

  return insights.slice(0, MAX_ITEMS);
}

function buildOverview(insights) {
  const main = insights[0]?.title || '今天暂无明显主线';
  return [
    '一、今日总览',
    '',
    `今天的信息密度主要集中在“${main.replace(/^.*?：/, '').replace(/，.*$/, '')}”。最值得关注的不是单个模型参数更新，而是 AI builder 生态正在从“调用模型”进入“管理模型、路由模型、审计模型、让 Agent 安全地做事”的阶段。`,
    '',
    '主线 1：AI Agent / Bot 流量快速增长，传统广告和网页访问逻辑受到挑战。',
    '',
    '主线 2：Cloudflare、Vercel、Anthropic 等都在围绕 AI Gateway、边缘推理、工具调用、成本控制做基础设施。',
    '',
    '主线 3：企业内部 AI 应用不止是写代码，也进入安全、审计、数据分析、代码发布等流程。',
    '',
    '主线 4：职业发展上，能把 AI 变成工作流能力的人，会比只会使用聊天框的人更有优势。'
  ];
}

function buildThemeSummary(insights) {
  const themes = [
    ['模型', 'Claude + Apple Foundation Models framework；Claude Fable 5 判断力；Anthropic 使用量强势', '重点不是只看 benchmark，而是看模型在真实 workflow 中是否能稳定做对决策。'],
    ['Agent', 'Bot/Agent 流量超过人类；Agentic workloads；代码/配置审查 Agent', 'Agent 会成为互联网的新用户，也会成为企业内部的新同事。'],
    ['开源', 'Vercel 观察到 open-weight AI 上升', '企业会在闭源 frontier model 和 open-weight model 之间做成本、控制权和性能权衡。'],
    ['大厂动态', 'Cloudflare、Anthropic/Apple、Vercel、OpenAI Codex 相关讨论', '基础设施公司正在争夺 AI 应用的控制层：网关、路由、审计、成本、安全。'],
    ['创业公司 / 工具', 'AI Gateway、token usage tracking、开发者工具化体验', '小团队机会在于帮 builder 把 AI 使用变得可观测、可控、可协作。'],
    ['产品趋势', '本地+云端混合 AI、Agent-friendly content、AI-native internal workflow', '下一阶段产品经理要设计的不只是 UI，而是给人和 Agent 都能使用的流程。']
  ];

  return [
    '三、按主题分类整理',
    '',
    ...themes.flatMap(([theme, signal, read]) => [
      `${theme}：`,
      `今日信号：${signal}`,
      `一句话解读：${read}`,
      ''
    ])
  ];
}

function buildGlossary(data) {
  const transcript = podcastTranscript(data);
  const blogText = (data.blogs || []).map((blog) => `${blog.title} ${blog.content}`).join(' ');
  const xText = (data.x || []).flatMap((builder) => builder.tweets || []).map((tweet) => tweet.text).join(' ');
  const all = `${transcript} ${blogText} ${xText}`;

  const terms = [
    ['AI Agent / Bot / Crawler', '可以自动访问网页、调用工具、完成任务的软件。Agent 是更正面的说法，crawler/scraper 更像爬取内容的机器访问。', ['agent', 'bot', 'crawler', 'scraper']],
    ['Agentic Internet', '一个由大量 AI Agent 代表人类访问网页、比较信息、下单、写代码、分析数据的互联网。网页访问者不再主要是人。', ['agentic']],
    ['AI Gateway', 'AI 应用和模型之间的控制台/中转站。它负责记录请求、控制成本、路由模型、加安全规则、做审计。', ['AI gateway']],
    ['Inference / Training', 'Training 是训练模型，成本高、需要大量 GPU 聚在一起；Inference 是模型被用户调用时生成答案，更适合靠近用户的边缘网络。', ['inference', 'training']],
    ['Edge Network / Edge Inference', '把计算节点放在离用户更近的地方，减少延迟。边缘推理就是在这些更近的节点上跑模型请求。', ['edge']],
    ['GPU / CPU', 'GPU 更擅长模型计算；CPU 负责大量通用计算。Agent 多起来后，不只 GPU 紧张，CPU 也会被大量消耗。', ['GPU', 'CPU']],
    ['Prompt Injection', '攻击者通过输入内容诱导 AI 忽略原本规则，例如让客服 Agent 说不该说的话或泄露信息。', ['prompt injection']],
    ['Token', '模型处理文字的基本计费单位，可以粗略理解为字/词片段。token 越多，成本和延迟通常越高。', ['token']],
    ['Frontier Model / Open-weight Model', 'Frontier model 指最前沿、通常闭源的大模型；open-weight model 指权重开放、可被企业自行部署或定制的模型。', ['open weight', 'open-weight', 'frontier']],
    ['Foundation Models framework', 'Apple 面向开发者的系统级 AI 框架，让 App 可以在 Swift 中更容易使用本地模型，并把复杂任务交给云端模型。', ['Foundation Models framework']],
    ['Structured Output / Guided Generation', '让模型输出固定格式的数据，而不是一段自由文本，方便程序直接使用。', ['structured', 'guided generation', 'Generable']],
    ['Tool Calls', '模型不只是回答文字，还能调用搜索、代码执行、数据库、API 等工具来完成任务。', ['tool call', 'tools']],
    ['Propensity Score Matching', '一种统计方法，用来让两组用户更可比。比如做留存分析时，先按活跃度匹配相似用户，避免把本来就更活跃的人误判为产品效果更好。', ['propensity score matching']],
    ['Log4j', '曾经影响极大的软件漏洞。文中用它比喻未来 AI 可能更快发现大量高危漏洞。', ['Log4j']],
    ['DDoS', '大量机器同时访问一个网站，把服务打瘫。Cloudflare 早期的重要能力之一就是防这类攻击。', ['DDoS']]
  ];

  const selected = terms.filter(([, , keywords]) => includesAny(all, keywords));
  const fallback = selected.length ? selected : terms.slice(0, 8);

  return [
    '四、重要技术名词解释（非纯技术背景版）',
    '',
    ...fallback.flatMap(([term, explanation]) => [`${term}：${explanation}`, ''])
  ];
}

function buildQuotes() {
  return [
    '五、可以发 LinkedIn 或面试中引用的 3 条观点',
    '',
    '1. AI Agent 正在从工具变成互联网的新用户。未来产品设计不只要服务人类点击，也要服务机器理解、调用和完成任务。',
    '',
    '2. 真正的企业级 AI 应用，核心不只是接入一个更强模型，而是建立 model routing、cost control、audit、security guardrails 这一整层治理能力。',
    '',
    '3. AI 对职业的影响不是简单替代人，而是重新定义价值：能把 AI 嵌入 workflow、提高质量和减少风险的人，会比只会单点使用工具的人更有竞争力。'
  ];
}

function buildActions() {
  return [
    '六、给你的行动建议',
    '',
    '产品视角：以后看 AI 产品时，额外问三个问题：谁是用户，人还是 Agent？数据入口是否结构化？成本和权限怎么控制？',
    '',
    '技术视角：可以补 AI Gateway、model routing、structured output、tool calls、CI/CD + AI review 这些概念。',
    '',
    '职业视角：你的产品经理 + 技术转型背景适合讲“我理解从业务 workflow 到技术落地的 AI 应用”，这比单纯说会用 ChatGPT 更有说服力。'
  ];
}

function buildDigest(data) {
  const date = new Date(data.generatedAt || Date.now()).toISOString().slice(0, 10);
  const insights = buildInsights(data);

  if (!insights.length) {
    return [
      `AI Builder Digest - ${date}`,
      '',
      '今天没有足够强的新内容信号。可以明天再看，或手动运行 /ai 获取最新 feed。',
      '',
      'Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders'
    ].join('\n');
  }

  const insightLines = insights.flatMap((insight, index) => {
    const lines = [
      `${index + 1}. ${insight.title}`,
      '',
      `分类：${insight.category}`,
      '',
      `发生了什么：${insight.what}`,
      '',
      `为什么重要：${insight.why}`,
      '',
      `对产品 / 技术 / 职业发展的启发：${insight.lesson}`,
      ''
    ];
    return [...addSources(lines, insight.source), ''];
  });

  return [
    `AI Builder Digest - ${date}`,
    '',
    ...buildOverview(insights),
    '',
    '二、今日最值得关注的 5 条 AI Builder 资讯',
    '',
    ...insightLines,
    ...buildThemeSummary(insights),
    ...buildGlossary(data),
    ...buildQuotes(),
    '',
    ...buildActions(),
    '',
    'Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders'
  ].join('\n');
}

async function main() {
  const raw = await readInput();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    throw new Error(data.message || 'prepare-digest did not return ok status');
  }

  process.stdout.write(buildDigest(data));
}

main().catch((err) => {
  console.error(JSON.stringify({ status: 'error', message: err.message }));
  process.exit(1);
});
