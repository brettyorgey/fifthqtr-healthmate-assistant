import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
  // project: process.env.OPENAI_PROJECT_ID, // uncomment if your account requires it
  // organization: process.env.OPENAI_ORG_ID // uncomment if your account requires it
});

async function main() {
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';
  const vectorStoreName = process.env.VECTOR_STORE_NAME || 'FifthQtr Healthmate Knowledge';
  const assistantName = process.env.ASSISTANT_NAME || 'FifthQtr Healthmate';

  // 1) Load instructions
  const instructionsPath = path.resolve('instructions.txt');
  const instructions = await fs.readFile(instructionsPath, 'utf8');

  console.log('> Creating vector store…');
  const vs = await client.vectorStores.create({ name: vectorStoreName });

  // 2) Upload all files in ./knowledge to the vector store
  const knowledgeDir = path.resolve('knowledge');
  const entries = await fs.readdir(knowledgeDir).catch(() => []);
  if (!entries.length) {
    console.log('! No files found in ./knowledge — the Assistant will still work but without citations.');
  } else {
    console.log(`> Uploading ${entries.length} file(s) to vector store ${vs.id}…`);
    // Using fileBatches API to upload multiple files and wait for indexing
    const files = await Promise.all(entries.map(async (name) => {
      const full = path.join(knowledgeDir, name);
      return await client.files.create({
        file: await fs.readFile(full),
        purpose: 'assistants',
        filename: name
      });
    }));

    const batch = await client.vectorStores.fileBatches.upload({
      vector_store_id: vs.id,
      files: files.map(f => f.id)
    });

    // Poll until batch is processed
    console.log('> Indexing files…');
    let done = false;
    while (!done) {
      const status = await client.vectorStores.fileBatches.retrieve({
        vector_store_id: vs.id,
        batch_id: batch.id
      });
      process.stdout.write(`\r   status: ${status.status} (processed: ${status.file_counts?.processed} / total: ${status.file_counts?.total})  `);
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'canceled') {
        done = true;
        console.log(); // newline
        if (status.status !== 'completed') {
          console.warn('! Batch did not complete successfully:', status.status);
        }
      }
      if (!done) await new Promise(r => setTimeout(r, 1200));
    }
  }

  // 3) Create Assistant with File Search tool referencing the vector store
  console.log('> Creating assistant…');
  const assistant = await client.assistants.create({
    name: assistantName,
    model,
    instructions,
    tools: [{ type: 'file_search' }],
    tool_resources: {
      file_search: { vector_store_ids: [vs.id] }
    },
    // You can add metadata tags if helpful:
    metadata: { product: 'fifthqtr-healthmate', env: 'prod' }
  });

  console.log('\n✅ Done!');
  console.log('Assistant name:', assistant.name);
  console.log('Assistant id:', assistant.id);
  console.log('Vector store id:', vs.id);
  console.log('\nNext steps:');
  console.log('1) Put OPENAI_ASSISTANT_ID in your Vercel project env vars.');
  console.log('2) Deploy and test.');
}

main().catch(err => {
  console.error('\nERROR in setup:', err?.response?.data || err);
  process.exit(1);
});
