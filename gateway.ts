import { streamText } from 'ai';
import 'dotenv/config';

async function main() {
  const result = streamText({
    model: 'openai/gpt-4.1',
    prompt: 'Invent a new holiday and describe its traditions.',
  });

  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  }

  console.log();
  console.log('Token usage:', await result.usage);
  console.log('Finish reason:', await result.finishReason);
}

main().catch(console.error);

curl -X POST "https://ai-gateway.vercel.sh/v1/chat/completions"
-H "Authorization: Bearer $AI_GATEWAY_API_KEY"
-H "Content-Type: application/json"
-d {
  "model": 'openai/gpt-5.2',
  "messages": [
    {
      "role": "user",
      "content": "Why is the sky blue?"
    }
  ],
  "stream": false
}