#!/usr/bin/env node

// ============================================================================
// Follow Builders — Deterministic Briefing Generator
// ============================================================================
// Turns prepare-digest.js JSON into a structured Chinese briefing. If
// OPENAI_API_KEY is available, it uses the OpenAI API for a natural-language
// briefing; otherwise it falls back to a deterministic local generator.
//
// Usage:
//   node prepare-digest.js | node generate-briefing.js | node deliver.js
//   node generate-briefing.js --file /path/to/prepared.json
// ============================================================================

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { config as loadEnv } from 'dotenv';

const MAX_ITEMS = 5;
const USER_DIR = join(homedir(), '.follow-builders');
const ENV_PATH = join(USER_DIR, '.env');
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const DEFAULT_REASONING_EFFORT = 'medium';
const DEFAULT_PROMPT_VERSION = 'ai-digest-yian-style-v1';

const YIAN_STYLE_PROMPT = [
  "You are Yian's AI Builder Digest assistant.",
  '',
  "Your job is to read a JSON file generated from selected AI builders' tweets/posts,",
  'then produce a Chinese digest for Yian.',
  '',
  'Yian is a MSc Computer Science student at UCD, with product management,',
  'consulting, payments, and software engineering interests.',
  '',
  'Output style:',
  '- 中文为主',
  '- 适合非纯技术背景理解',
  '- 不要只是翻译，要解释发生了什么、为什么重要、对产品/技术/职业发展有什么启发',
  '- 重点关注 AI builder、agent、开源、模型、大厂动态、创业公司、产品趋势',
  '- 用清晰分组',
  '- 每条资讯都要有：发生了什么 / 为什么重要 / 对 Yian 的启发',
  '- 最后输出 3 条可以用于 LinkedIn 或面试表达的观点'
].join('\n');

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

function addSources(lines, urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return lines;
  return [...lines, '来源：', ...unique];
}

const CATEGORY_RULES = [
  ['模型 / Agent', ['ai', 'agi', 'agent', 'llm', 'model', 'claude', 'gpt', 'gemini', 'anthropic', 'openai', 'fable', 'inference', 'benchmark', 'eval']],
  ['开源', ['open source', 'open-source', 'open weight', 'open-weight', 'oss', 'github']],
  ['大厂动态', ['google', 'microsoft', 'meta', 'apple', 'amazon', 'cloudflare', 'anthropic', 'openai', 'vercel', 'claude', 'chatgpt']],
  ['创业公司 / 工具', ['startup', 'founder', 'builder', 'tool', 'product', 'developer', 'code', 'codex', 'cursor', 'replit']],
  ['产品趋势', ['workflow', 'users', 'usage', 'launch', 'shipping', 'growth', 'retention', 'enterprise', 'customer']]
];

const IMPORTANT_TERMS = [
  'ai', 'agi', 'agent', 'llm', 'model', 'claude', 'chatgpt', 'openai', 'anthropic',
  'gemini', 'gpt', 'fable', 'codex', 'cursor', 'replit', 'vercel', 'github',
  'open source', 'open-weight', 'open weight', 'eval', 'benchmark', 'token',
  'prompt', 'inference', 'gpu', 'api', 'tool', 'workflow', 'automation',
  'developer', 'code', 'enterprise', 'startup', 'founder', 'revenue', 'product'
];

function compact(text = '', maxLength = 220) {
  const cleaned = stripHtml(text);
  if (cleaned.length <= maxLength) return cleaned;

  const shortened = cleaned.slice(0, maxLength);
  const sentenceEnd = Math.max(
    shortened.lastIndexOf('.'),
    shortened.lastIndexOf('!'),
    shortened.lastIndexOf('?'),
    shortened.lastIndexOf('。'),
    shortened.lastIndexOf('！'),
    shortened.lastIndexOf('？')
  );
  const end = sentenceEnd > maxLength * 0.45 ? sentenceEnd + 1 : maxLength;
  return `${shortened.slice(0, end).trim()}...`;
}

function sentencesFrom(text = '') {
  return stripHtml(text)
    .replace(/Speaker\s+\d+\s*\|\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, '')
    .replace(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g, '')
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function bestSnippet(text = '', fallback = '') {
  const sentences = sentencesFrom(text);
  const best = sentences
    .slice(0, 80)
    .map((sentence, index) => ({
      sentence,
      score: relevanceScore(sentence) - index * 0.15
    }))
    .sort((a, b) => b.score - a.score)[0]?.sentence;

  return compact(best || fallback || text, 260);
}

function relevanceScore(text = '') {
  const lower = stripHtml(text).toLowerCase();
  const termScore = IMPORTANT_TERMS.reduce((score, term) => (
    lower.includes(term) ? score + 1 : score
  ), 0);
  const lengthScore = Math.min(lower.length / 280, 1);
  return termScore * 10 + lengthScore;
}

function categoriesFor(text = '') {
  const lower = stripHtml(text).toLowerCase();
  const matched = CATEGORY_RULES
    .map(([category, terms]) => ({
      category,
      score: terms.reduce((score, term) => (
        lower.includes(term.toLowerCase()) ? score + 1 : score
      ), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.category);

  return matched.length ? matched.slice(0, 3) : ['产品趋势'];
}

function primaryCategory(categories) {
  return categories[0] || '产品趋势';
}

function whyFor(categories) {
  const category = primaryCategory(categories);
  if (category === '模型 / Agent') {
    return '这条信号说明 AI 能力正在进入更具体的使用场景，判断重点不只是模型有多强，而是它能否稳定地完成任务、调用工具并融入工作流。';
  }
  if (category === '开源') {
    return '开源和 open-weight 信号会影响企业在成本、可控性、部署方式和生态绑定上的选择，是判断 AI 基础设施走向的重要线索。';
  }
  if (category === '大厂动态') {
    return '大厂和核心平台的动作通常会改变开发者生态、产品默认能力和用户预期，值得跟踪它们把资源押在哪里。';
  }
  if (category === '创业公司 / 工具') {
    return 'builder 的一线反馈往往比正式发布更早暴露真实需求，可以帮助判断哪些 AI 工具已经从 demo 进入日常生产。';
  }
  return '这类变化能帮助判断 AI 产品和工作方式的默认预期正在如何变化。';
}

function lessonFor(categories) {
  const category = primaryCategory(categories);
  if (category === '模型 / Agent') {
    return '产品：把 AI 能力拆成可验证的具体任务。技术：关注 eval、tool calls、上下文和失败恢复。职业：练习把 AI 能力翻译成业务流程价值。';
  }
  if (category === '开源') {
    return '产品：关注开源生态如何影响采用门槛。技术：理解闭源 API 与 open-weight/self-host 的取舍。职业：用小项目展示模型选择和部署判断。';
  }
  if (category === '大厂动态') {
    return '产品：观察平台能力变化会如何重塑用户入口和分发。技术：关注平台 API、权限和集成方式。职业：能解释平台趋势的人更容易连接业务和技术。';
  }
  if (category === '创业公司 / 工具') {
    return '产品：优先关注真实工作流里的高频摩擦。技术：把工具串进可复用流程，而不是只停留在聊天框。职业：记录具体场景会比泛泛谈 AI 更有说服力。';
  }
  return '产品：提炼真实需求。技术：关注可落地的流程改进。职业：积累能说明业务价值的 AI 使用案例。';
}

function titleFrom(source, text) {
  const snippet = compact(text, 88);
  return `${source}：${snippet}`;
}

function substantiveText(text = '') {
  return stripHtml(text)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCandidates(data) {
  const candidates = [];

  for (const blog of data.blogs || []) {
    if (!blog.url) continue;
    const text = `${blog.title || ''}\n${blog.description || ''}\n${blog.content || ''}`;
    const categories = categoriesFor(text);
    candidates.push({
      id: blog.url,
      sourceType: 'blog',
      sourceName: blog.name || 'Blog',
      title: stripHtml(blog.title || 'Untitled blog post'),
      url: blog.url,
      content: compact(text, 3000),
      score: 95 + relevanceScore(text),
      publishedAt: blog.publishedAt,
      insight: {
        category: primaryCategory(categories),
        title: titleFrom(blog.name || 'Blog', blog.title || bestSnippet(text)),
        what: `${blog.name || 'Blog'} 发布了「${stripHtml(blog.title || '新文章')}」。核心信息：${bestSnippet(text, blog.description || blog.title)}`,
        why: whyFor(categories),
        lesson: lessonFor(categories),
        source: [blog.url],
        themes: categories
      }
    });
  }

  for (const podcast of data.podcasts || []) {
    if (!podcast.url) continue;
    const text = `${podcast.title || ''}\n${podcast.transcript || ''}`;
    const categories = categoriesFor(text);
    candidates.push({
      id: podcast.url,
      sourceType: 'podcast',
      sourceName: podcast.name || 'Podcast',
      title: stripHtml(podcast.title || 'Untitled podcast episode'),
      url: podcast.url,
      content: compact(sentencesFrom(text).slice(0, 45).join(' '), 4500),
      score: 85 + relevanceScore(text),
      publishedAt: podcast.publishedAt,
      insight: {
        category: primaryCategory(categories),
        title: titleFrom(podcast.name || 'Podcast', podcast.title || bestSnippet(text)),
        what: `${podcast.name || 'Podcast'} 的「${stripHtml(podcast.title || '新节目')}」讨论了：${bestSnippet(text, podcast.title)}`,
        why: whyFor(categories),
        lesson: lessonFor(categories),
        source: [podcast.url],
        themes: categories
      }
    });
  }

  for (const builder of data.x || []) {
    const tweets = (builder.tweets || []).filter((tweet) =>
      tweet.url && substantiveText(tweet.text).length >= 25
    );
    for (const tweet of tweets) {
      const text = `${builder.name || ''}\n${builder.bio || ''}\n${tweet.text || ''}`;
      const categories = categoriesFor(text);
      const engagement = Math.log10((tweet.likes || 0) + 1) * 8 +
        Math.log10((tweet.retweets || 0) + 1) * 5 +
        Math.log10((tweet.replies || 0) + 1) * 3;

      candidates.push({
        id: tweet.url,
        sourceType: 'x',
        sourceName: builder.name || builder.handle || 'Builder',
        title: `${builder.name || builder.handle || 'Builder'} on X`,
        url: tweet.url,
        content: stripHtml(tweet.text || ''),
        authorBio: stripHtml(builder.bio || ''),
        engagement: {
          likes: tweet.likes || 0,
          retweets: tweet.retweets || 0,
          replies: tweet.replies || 0
        },
        score: 45 + relevanceScore(text) + engagement,
        publishedAt: tweet.createdAt,
        insight: {
          category: primaryCategory(categories),
          title: titleFrom(builder.name || builder.handle || 'Builder', tweet.text),
          what: `${builder.name || builder.handle || '一位 builder'}${builder.bio ? `（${compact(builder.bio, 90)}）` : ''} 分享：${compact(tweet.text, 260)}`,
          why: whyFor(categories),
          lesson: lessonFor(categories),
          source: [tweet.url],
          themes: categories
        }
      });
    }
  }

  return candidates;
}

function buildInsights(data) {
  const usedAuthors = new Map();
  const usedUrls = new Set();

  return buildCandidates(data)
    .filter((candidate) => relevanceScore(`${candidate.insight.title} ${candidate.insight.what}`) > 0)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (usedUrls.has(candidate.id)) return false;
      const authorCount = usedAuthors.get(candidate.sourceName) || 0;
      if (candidate.sourceType === 'x' && authorCount >= 1) return false;

      usedUrls.add(candidate.id);
      usedAuthors.set(candidate.sourceName, authorCount + 1);
      return true;
    })
    .slice(0, MAX_ITEMS)
    .map((candidate) => candidate.insight);
}

function buildModelItems(data, limit = 14) {
  const usedAuthors = new Map();
  const usedUrls = new Set();

  return buildCandidates(data)
    .filter((candidate) => relevanceScore(`${candidate.title} ${candidate.content}`) > 0)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (usedUrls.has(candidate.id)) return false;
      const authorCount = usedAuthors.get(candidate.sourceName) || 0;
      if (candidate.sourceType === 'x' && authorCount >= 2) return false;

      usedUrls.add(candidate.id);
      usedAuthors.set(candidate.sourceName, authorCount + 1);
      return true;
    })
    .slice(0, limit)
    .map((candidate) => ({
      type: candidate.sourceType,
      source: candidate.sourceName,
      title: candidate.title,
      url: candidate.url,
      publishedAt: candidate.publishedAt,
      categoryHint: candidate.insight.category,
      authorBio: candidate.authorBio,
      engagement: candidate.engagement,
      content: candidate.content
    }));
}

function buildOpenAIPrompt(data, items) {
  const date = new Date(data.generatedAt || Date.now()).toISOString().slice(0, 10);
  const stats = data.stats || {};
  const promptVersion = process.env.DIGEST_PROMPT_VERSION || DEFAULT_PROMPT_VERSION;

  return [
    `Prompt version: ${promptVersion}`,
    '',
    YIAN_STYLE_PROMPT,
    '',
    'Execution rules:',
    '请只根据下面 JSON 中的候选内容写一封中文邮件 briefing。不要访问网页，不要编造，不要使用候选内容之外的事实。',
    '',
    '硬性要求：',
    '- 输出简体中文为主，专业但 conversational，像懂行朋友在解释。',
    '- 必须选出 5 条 AI 资讯。每条都必须来自候选 JSON，并保留原始 URL。',
    '- 5 条不要重复同一件事；优先选择信息量高、和 AI 产品/模型/agent/开发者工具相关的内容。',
    '- 每条都要有独立的“发生了什么”“为什么重要”“对 Yian 的启发”，不要模板化重复。',
    '- 如果候选里有 podcast 或 blog，可以总结核心观点；如果是 tweet，要基于 tweet 原文和作者 bio 解读，不要夸大。',
    '- 保留 AI、LLM、agent、token、API、open-weight、workflow、eval 等常用英文术语。',
    '- 来源 URL 必须逐条列出。没有 URL 的内容不要写。',
    '- 不要提到你是 AI，不要提到 prompt，不要说“根据 JSON”。',
    '',
    '请使用这个固定结构：',
    `标题：AI Builder Digest - ${date}`,
    '',
    '一、今日总览',
    '用 3-5 句话概括今天的主线。不要空泛。',
    '',
    '二、今日最值得关注的 5 条 AI Builder 资讯',
    '每条格式：',
    '1. 标题',
    '分类：模型 / Agent、开源、大厂动态、创业公司 / 工具、产品趋势 中选 1-2 个',
    '发生了什么：',
    '为什么重要：',
    '对 Yian 的启发：',
    '来源：',
    '',
    '三、按主题分类整理',
    '必须严格模仿下面格式，不要使用 markdown bullet，不要把多个主题合并成一个标题：',
    '模型 / Agent：',
    '今日信号：用分号串联 1-3 个今天真实出现的信号；如果没有就写“今日无强信号”',
    '一句话解读：用一句具体判断解释这个主题今天说明了什么。',
    '',
    '开源：',
    '今日信号：...',
    '一句话解读：...',
    '',
    '大厂动态：',
    '今日信号：...',
    '一句话解读：...',
    '',
    '创业公司 / 工具：',
    '今日信号：...',
    '一句话解读：...',
    '',
    '产品趋势：',
    '今日信号：...',
    '一句话解读：...',
    '',
    '这一部分的风格要像短 briefing 里的分类索引，紧凑、平实、方便扫描；不要写长段落。',
    '',
    '四、重要技术名词解释（非纯技术背景版）',
    '只解释正文里实际出现的 6-10 个术语。必须严格使用“术语：解释”的格式，每个术语单独一行，不要使用 markdown bullet，不要使用编号。解释要像周日报告那样，适合非纯技术背景读者理解，但不要太口语化。',
    '示例格式：',
    'AI Agent：可以自动访问网页、调用工具、完成任务的软件。',
    'Token：模型处理文字的基本计费单位，可以粗略理解为字/词片段。',
    '',
    '五、可以发 LinkedIn 或面试中引用的 3 条观点',
    '观点要具体、有判断力。',
    '',
    '六、给你的行动建议',
    '必须严格输出三行，每行一个视角，格式如下。不要把“产品视角/技术视角/职业视角”单独作为标题，不要写多段落：',
    '产品视角：一句到两句，说明今天这些资讯对产品判断或产品设计的启发。',
    '技术视角：一句到两句，说明应该补哪些技术概念、架构能力或实践方向。',
    '职业视角：一句到两句，说明如何把今天内容转成面试、作品集、学习路线或工作表达里的优势。',
    '',
    '结尾保留：Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders',
    '',
    '今日 feed 统计：',
    JSON.stringify({
      podcastEpisodes: stats.podcastEpisodes || 0,
      xBuilders: stats.xBuilders || 0,
      totalTweets: stats.totalTweets || 0,
      blogPosts: stats.blogPosts || 0,
      feedGeneratedAt: stats.feedGeneratedAt || null
    }, null, 2),
    '',
    '候选内容 JSON：',
    JSON.stringify(items, null, 2)
  ].join('\n');
}

function extractResponseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const text = (response.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || '')
    .filter(Boolean)
    .join('\n')
    .trim();

  return text;
}

function openAIErrorCode(err) {
  const message = err?.message || '';
  const match = message.match(/"code"\s*:\s*"([^"]+)"/);
  if (match) return match[1];
  if (message.includes('insufficient_quota')) return 'insufficient_quota';
  return 'unknown_error';
}

async function buildDigestWithOpenAI(data) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const items = buildModelItems(data);
  if (!items.length) return null;

  const prompt = buildOpenAIPrompt(data, items);
  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: 5000
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${detail}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error('OpenAI API returned an empty briefing');

  return text;
}

function buildOverview(insights) {
  const main = insights[0]?.title || '今天暂无明显主线';
  const themeCounts = countThemes(insights);
  const topThemes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([theme]) => theme);

  return [
    '一、今日总览',
    '',
    `今天的信息密度主要集中在“${compact(main.replace(/^.*?：/, ''), 80)}”。这份 briefing 只使用当天远端 feed 中带来源链接的内容，优先选择 AI 相关性更高、信号更明确的 builder 更新。`,
    '',
    `主线 1：${topThemes[0] || '模型 / Agent'} 是今天最明显的方向。`,
    '',
    `主线 2：${topThemes[1] || '产品趋势'} 相关讨论值得继续跟踪。`,
    '',
    `主线 3：${topThemes[2] || '创业公司 / 工具'} 信号显示 AI 正在进入更具体的工作流。`,
    '',
    `主线 4：${topThemes[3] || '大厂动态'} 可以作为判断平台和生态变化的参考。`
  ];
}

function countThemes(insights) {
  const counts = new Map();
  for (const insight of insights) {
    for (const theme of insight.themes || ['产品趋势']) {
      counts.set(theme, (counts.get(theme) || 0) + 1);
    }
  }
  return counts;
}

function buildThemeSummary(insights) {
  const themeCounts = countThemes(insights);
  const themes = ['模型 / Agent', '开源', '大厂动态', '创业公司 / 工具', '产品趋势'];

  return [
    '三、按主题分类整理',
    '',
    ...themes.flatMap((theme) => {
      const related = insights.filter((insight) => (insight.themes || []).includes(theme));
      const signal = related.length
        ? related.map((insight) => insight.title.replace(/^.*?：/, '')).slice(0, 2).join('；')
        : '今日无强信号';
      const read = themeCounts.has(theme)
        ? `今天有 ${themeCounts.get(theme)} 条相关内容，说明这个方向在当天 feed 中有明确出现。`
        : '今天 feed 中没有足够明确的相关内容，不硬凑。';

      return [
      `${theme}：`,
      `今日信号：${signal}`,
      `一句话解读：${read}`,
      ''
      ];
    })
  ];
}

function buildGlossary(data) {
  const transcript = (data.podcasts || []).map((podcast) => podcast.transcript || '').join(' ');
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
    '1. 看 AI 资讯时，不要只问“模型有没有变强”，更要问“它进入了哪个真实工作流”。',
    '',
    '2. Builder 的一线分享通常比正式发布更早暴露机会点，因为它来自真实使用、真实摩擦和真实取舍。',
    '',
    '3. 未来的 AI 竞争力不只是会用工具，而是能把工具放进可复用、可衡量、可交付的流程里。'
  ];
}

function buildActions() {
  return [
    '六、给你的行动建议',
    '',
    '产品视角：看每条更新时，追问它解决的是谁的高频问题，以及是否已经进入真实 workflow。',
    '',
    '技术视角：把今天出现的关键词拆成可学习的小主题，例如 eval、agent、API、workflow、open-weight 或 developer tools。',
    '',
    '职业视角：把 digest 中的一条信号转成自己的判断：它改变了什么工作方式、产品机会或技能要求。'
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
  loadEnv({ path: ENV_PATH });

  const raw = await readInput();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    throw new Error(data.message || 'prepare-digest did not return ok status');
  }

  try {
    const llmDigest = await buildDigestWithOpenAI(data);
    if (llmDigest) {
      process.stdout.write(llmDigest);
      return;
    }
  } catch (err) {
    console.error(`OpenAI briefing failed: ${openAIErrorCode(err)}`);
    console.error('Falling back to deterministic briefing');
    console.error(err.message);
  }

  process.stdout.write(buildDigest(data));
}

main().catch((err) => {
  console.error(JSON.stringify({ status: 'error', message: err.message }));
  process.exit(1);
});
