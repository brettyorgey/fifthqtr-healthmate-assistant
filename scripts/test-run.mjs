import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
  // project: process.env.OPENAI_PROJECT_ID,
  // organization: process.env.OPENAI_ORG_ID
});

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID; // set after running setup.mjs

function collectTextAndCitations(message) {
  let text = '';
  const cites = [];
  for (const part of message?.content || []) {
    if (part.type === 'text' && part.text?.value) {
      if (text) text += '\n\n';
      text += part.text.value;
      for (const ann of (part.text.annotations || [])) {
        if (ann.file_citation?.file_id) {
          cites.push({
            file_id: ann.file_citation.file_id,
            quote: ann.file_citation.quote || ''
          });
        }
      }
    }
  }
  return { text, cites };
}

async function main() {
  if (!ASSISTANT_ID) {
    console.error('Please set OPENAI_ASSISTANT_ID in .env first.');
    process.exit(1);
  }

  // 1) Create thread
  const thread = await client.threads.create();

  // 2) Add a user message
  const question = "Where can a retired AFL player get help for memory and thinking concerns in Australia?";
  await client.threads.messages.create(thread.id, {
    role: 'user',
    content: question
  });

  // 3) Run assistant
  const run = await client.threads.runs.create(thread.id, { assistant_id: ASSISTANT_ID });

  // 4) Poll
  let done = false;
  while (!done) {
    const r = await client.threads.runs.retrieve(thread.id, run.id);
    if (['completed', 'failed', 'cancelled', 'expired'].includes(r.status)) {
      done = true;
      if (r.status !== 'completed') {
        console.error('Run status:', r.status, r.last_error || '');
        process.exit(1);
      }
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 5) Get messages
  const list = await client.threads.messages.list(thread.id, { limit: 10 });
  const assistantMsg = list.data.find(m => m.role === 'assistant');
  if (!assistantMsg) {
    console.log('No assistant message found.');
    return;
  }

  const { text, cites } = collectTextAndCitations(assistantMsg);
  console.log('\n--- Answer ---\n');
  console.log(text || '(no text)');

  if (cites.length) {
    console.log('\n--- Sources ---');
    // Resolve filenames
    const unique = [...new Map(cites.map(c => [c.file_id, c])).values()];
    for (const c of unique) {
      try {
        const f = await client.files.retrieve(c.file_id);
        console.log(`- ${f.filename}${c.quote ? ` — “${c.quote}”` : ''}`);
      } catch {
        console.log(`- ${c.file_id}${c.quote ? ` — “${c.quote}”` : ''}`);
      }
    }
  }
}

main().catch(err => {
  console.error('\nERROR in test:', err?.response?.data || err);
  process.exit(1);
});
