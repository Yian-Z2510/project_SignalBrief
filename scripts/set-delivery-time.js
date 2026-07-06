#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'send-digest.yml');
const README_PATH = join(REPO_ROOT, 'README.md');
const DEFAULT_TIMEZONE = 'Europe/Dublin';

function usage() {
  console.error('Usage: npm run set-delivery-time -- HH:MM [Timezone]');
  console.error('Example: npm run set-delivery-time -- 14:20 Europe/Dublin');
}

function parseDeliveryTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  if (!match) {
    usage();
    process.exit(1);
  }

  return { hour: match[1], minute: match[2], value };
}

function formatLocalTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function utcCronForLocalTime(date, deliveryTime, timeZone) {
  for (let hour = 0; hour < 24; hour += 1) {
    const utcHour = String(hour).padStart(2, '0');
    const candidate = new Date(`${date}T${utcHour}:${deliveryTime.minute}:00Z`);
    if (formatLocalTime(candidate, timeZone) === deliveryTime.value) {
      return `${deliveryTime.minute} ${hour} * * *`;
    }
  }

  throw new Error(`Could not map ${deliveryTime.value} ${timeZone} to a UTC cron slot for ${date}`);
}

function replaceOnce(text, pattern, replacement, label) {
  if (!pattern.test(text)) {
    throw new Error(`Could not update ${label}`);
  }
  return text.replace(pattern, replacement);
}

const deliveryTime = parseDeliveryTime(process.argv[2]);
const timeZone = process.argv[3] || DEFAULT_TIMEZONE;
const summerCron = utcCronForLocalTime('2026-07-15', deliveryTime, timeZone);
const winterCron = utcCronForLocalTime('2026-01-15', deliveryTime, timeZone);
const crons = [...new Set([summerCron, winterCron])].sort((a, b) => {
  const [, hourA] = a.split(' ').map(Number);
  const [, hourB] = b.split(' ').map(Number);
  return hourA - hourB;
});

let workflow = await readFile(WORKFLOW_PATH, 'utf8');
workflow = replaceOnce(
  workflow,
  /    - cron: "\d{1,2} \d{1,2} \* \* \*"\n    - cron: "\d{1,2} \d{1,2} \* \* \*"/,
  crons.map((cron) => `    - cron: "${cron}"`).join('\n'),
  'workflow cron entries'
);
workflow = replaceOnce(
  workflow,
  /      DIGEST_TIMEZONE: .+/,
  `      DIGEST_TIMEZONE: ${timeZone}`,
  'workflow timezone'
);
workflow = replaceOnce(
  workflow,
  /      DIGEST_DELIVERY_TIME: "\d{2}:\d{2}"/,
  `      DIGEST_DELIVERY_TIME: "${deliveryTime.value}"`,
  'workflow delivery time'
);
workflow = replaceOnce(
  workflow,
  /            "\d{1,2} \d{1,2} \* \* \*"\) scheduled_utc_hour="\d{1,2}"; scheduled_utc_minute="\d{2}" ;;\n            "\d{1,2} \d{1,2} \* \* \*"\) scheduled_utc_hour="\d{1,2}"; scheduled_utc_minute="\d{2}" ;;/,
  crons.map((cron) => {
    const [minute, hour] = cron.split(' ');
    return `            "${cron}") scheduled_utc_hour="${hour.padStart(2, '0')}"; scheduled_utc_minute="${minute.padStart(2, '0')}" ;;`;
  }).join('\n'),
  'workflow schedule gate'
);
await writeFile(WORKFLOW_PATH, workflow);

let readme = await readFile(README_PATH, 'utf8');
readme = replaceOnce(
  readme,
  /The scheduled workflow runs daily at about \d{2}:\d{2} [A-Za-z/_]+./,
  `The scheduled workflow runs daily at about ${deliveryTime.value} ${timeZone}.`,
  'README delivery time'
);
await writeFile(README_PATH, readme);

console.log(`Delivery time set to ${deliveryTime.value} ${timeZone}`);
console.log(`GitHub Actions cron slots: ${crons.join(', ')}`);
