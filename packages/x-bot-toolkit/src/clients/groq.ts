import Groq from 'groq-sdk';

// Use TypeScript's Parameters utility to robustly get the type for the create method's parameters
type GroqCompletionCreateParams = Parameters<Groq['chat']['completions']['create']>[0];

/**
 * A generic interface for the data structure expected from the LLM.
 */
export interface LlmResponse {
  [key: string]: any;
}

/**
 * A client for interacting with the Groq API.
 */
export class GroqClient {
  private groq: Groq;

  /**
   * Creates an instance of GroqClient.
   * @param apiKey The Groq API key.
   */
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Groq API key is required.');
    }
    this.groq = new Groq({ apiKey });
  }

  /**
   * Generates a response from the Groq API using a provided model.
   * @param systemPrompt The system prompt defining the AI's role and rules.
   * @param userPrompt The user prompt containing the specific request.
   * @param model The LLM model to use for the generation.
   * @param responseFormat The desired response format.
   * @returns A promise that resolves to the parsed JSON object or a string.
   */
  async generateResponse<T extends LlmResponse>(
    systemPrompt: string, 
    userPrompt: string,
    model: string = 'openai/gpt-oss-120b',
    responseFormat?: GroqCompletionCreateParams['response_format']
  ): Promise<T | string> {
    const callIdentifier = Math.random().toString(36).substring(7);
    console.log(`[GroqClient-${callIdentifier}] generateResponse called.`);
    console.log(`[GroqClient-${callIdentifier}]   Model: ${model}`);
    console.log(`[GroqClient-${callIdentifier}]   System Prompt: ${systemPrompt.substring(0, 200)}...`); // Log truncated prompt
    console.log(`[GroqClient-${callIdentifier}]   User Prompt: ${userPrompt.substring(0, 200)}...`); // Log truncated prompt
    if (responseFormat) {
      console.log(`[GroqClient-${callIdentifier}]   Response Format: ${JSON.stringify(responseFormat)}`);
    }

    const completionParams: GroqCompletionCreateParams = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: model,
      temperature: 0.75,
      stream: false,
    };

    if (responseFormat) {
      completionParams.response_format = responseFormat;
    }

    const chatCompletion = await this.groq.chat.completions.create(completionParams) as Groq.Chat.ChatCompletion;
    const generatedContent = chatCompletion.choices[0]?.message?.content;

    if (!generatedContent) {
      console.error(`[GroqClient-${callIdentifier}] Groq API did not return any content.`);
      throw new Error('Groq API did not return any content.');
    }
    console.log(`[GroqClient-${callIdentifier}] Generated Content (truncated): ${generatedContent.substring(0, 200)}...`);

    if (responseFormat?.type === 'json_object' || responseFormat?.type === 'json_schema') {
      try {
        const parsedJson = JSON.parse(generatedContent);
        console.log(`[GroqClient-${callIdentifier}] Parsed JSON response.`);
        return parsedJson as T;
      } catch (e: any) {
        console.error(`[GroqClient-${callIdentifier}] Failed to parse LLM JSON response:`, e.message);
        console.error(`[GroqClient-${callIdentifier}] Raw LLM output:`, generatedContent);
        throw new Error('LLM did not return a valid JSON object as requested.');
      }
    }

    console.log(`[GroqClient-${callIdentifier}] Returning string content.`);
    return generatedContent;
  }
}
