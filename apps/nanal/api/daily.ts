import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import { GroqClient, TwitterClient } from '@hakyung/x-bot-toolkit';

const handler = async (req: VercelRequest, res: VercelResponse) => {
  const runIdentifier = Math.random().toString(36).substring(7);
  console.log(`[${runIdentifier}] Function start.`);

  // 1. Authenticate cron job request
  const isCron = req.headers['authorization']?.split(' ')[1] === process.env.CRON_SECRET;
  const isDryRun = req.query.dryRun === 'true';
  console.log(`[${runIdentifier}] Run mode: cron=${isCron}, dryRun=${isDryRun}`);

  if (!isCron && !isDryRun) {
    console.log(`[${runIdentifier}] Unauthorized access attempt.`);
    return res.status(401).send('Unauthorized');
  }

  try {
    // 2. Initialize Clients
    const groqClient = new GroqClient(process.env.GROQ_API_KEY!);
    const twitterClient = new TwitterClient({
      appKey: process.env.X_APP_KEY!,
      appSecret: process.env.X_APP_SECRET!,
      accessToken: process.env.X_ACCESS_TOKEN!,
      accessSecret: process.env.X_ACCESS_SECRET!,
    });
    console.log(`[${runIdentifier}] Clients initialized.`);

    // 3. Get current date and check for special events
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const year = kstDate.getFullYear();
    const month = kstDate.getUTCMonth() + 1;
    const day = kstDate.getUTCDate();
    const koreanDateString = `${month}월 ${day}일`;
    const apiDateString = `${kstDate.toLocaleString('en-US', { month: 'long' })} ${day}`;
    console.log(`[${runIdentifier}] Target date (KST): ${year}년 ${koreanDateString}`);

    const specialEvents: string[] = [];
    if (month === 11 && day === 10) {
      if (year === 2025)
        specialEvents.push('나날 봇이 오늘부터 서비스를 시작합니다!')
      else
        specialEvents.push('나날 봇의 생일입니다. 나날 봇은 2025년 11월 10일에 서비스가 시작되었습니다.');
    }
    if (month === 4 && day === 10) {
      specialEvents.push('나날 봇을 만들어주신 창조주 @HaKyung410 님의 생일입니다. 하경은 2002년 4월 10일에 태어난 것으로 알려져 있습니다.');
    }
    if (specialEvents.length > 0) {
      console.log(`[${runIdentifier}] Special event detected: ${specialEvents.join(', ')}`);
    }

    let observances = '';

    // 4. Fetch data from Wikipedia API
    console.log(`[${runIdentifier}] Attempting to fetch observances from Wikipedia for ${apiDateString}`);
    try {
      const headers = { 
        'User-Agent': 'NaNalBot/1.0 (https://github.com/HK-410/hakyng-bots/tree/main/apps/nanal/; hakyung410+nanalbot@gmail.com)' 
      };
      const sectionsUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${apiDateString}&prop=sections&format=json`;
      const sectionsResponse = await axios.get(sectionsUrl, { headers });
      const sections = sectionsResponse.data.parse.sections;
      const holidaySection = sections.find((s: any) => s.line === 'Holidays and observances');

      if (holidaySection) {
        const sectionIndex = holidaySection.index;
        const contentUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${apiDateString}&prop=text&section=${sectionIndex}&format=json`;
        const contentResponse = await axios.get(contentUrl, { headers });

        const turndownService = new TurndownService({
          headingStyle: 'atx', // h2 -> ##
          bulletListMarker: '*', // ul/li -> *
          codeBlockStyle: 'fenced', // ```
        });
        
        turndownService.addRule('keepLinkTextOnly', {
          filter: 'a',
          replacement: function (content) {
            return content;
          }
        });

        const $ = cheerio.load(contentResponse.data.parse.text['*']);

        $('.mw-editsection').remove();
        $('.mw-references-wrap').remove();
        $('.mw-ext-cite-error').remove();
        $('.mw-heading').remove();
        $('sup.reference').remove();

        const contentHtml = $('.mw-parser-output').html();
        
        observances = turndownService.turndown(contentHtml);
        console.log("result:::", observances);
      }
    } catch (apiError) {
      console.error(`[${runIdentifier}] Wikipedia API fetch failed:`, apiError);
    }

    const systemPrompt = `
You are "나날", an information bot that tweets facts about today's date.

<Your Goal>
Create a single, focused, and informative tweet in Korean, under 280 characters. Your tweet should have ONE main theme and, if relevant, one or two related fun facts. The current year will be provided. Use it to calculate anniversaries (e.g., "N주년"). You will be given a list of observance objects, each with a "title" and a "description". Use the description to understand the context and tell a better story.

<How to Choose the Theme>
Analyze the provided list of observances and pick the main theme using this priority:
1.  **Special Event:** If a special event is provided, it MUST be the main theme.
2.  **Korean Holiday:** If no special event, and a Korean holiday exists, it is the main theme.
3.  **Famous Global Holiday:** If none of the above, pick a globally recognized one.
4.  **Most Interesting Topic:** If none of the above, pick the most interesting topic from the list.
5.  **Creative Fallback:** If all lists are empty, invent a fun, special day and present it as a fact.

<How to Write the Tweet>
- Focus on the main theme you chose.
- You can add one or two other interesting observances from the list as secondary fun facts, but don't let them distract from the main theme.
- State facts clearly and concisely.
- The tone must be neutral, objective, and informative.
- **CRITICAL: Avoid suggestive or conversational endings like '~해요', '~보세요', '~까요?'. Instead, use declarative endings like '~입니다', '~날입니다'.**
- Do not end the tweet with an ellipsis ("..."). Finish the sentence completely.
- The tweet MUST NOT contain any hashtags.
- Start the tweet with the format: "[Month]월 [Day]일, " (e.g., "11월 10일, ")
`;
    const userPrompt = `Today is ${year}년 ${koreanDateString}.
${specialEvents.length > 0 ? `\n**Today's Special Events:**\n- ${specialEvents.join('\n- ')}\n` : ''}
Here is the list of observances from Wikipedia:

\`\`\`
${observances}
\`\`\`

Follow the instructions to create a tweet.`;

    const tweetContent = await groqClient.generateResponse(
      systemPrompt,
      userPrompt,
      'openai/gpt-oss-120b'
    );

    if (typeof tweetContent !== 'string' || !tweetContent) {
      throw new Error(`[${runIdentifier}] Failed to generate tweet content.`);
    }
    console.log(`[${runIdentifier}] Successfully generated tweet content.`);

    // 6. Post to Twitter (or log for dry run)
    if (isDryRun) {
      console.log(`[${runIdentifier}] --- DRY RUN ---`);
      console.log(`[${runIdentifier}] Tweet content for ${koreanDateString} (${twitterClient.calculateBytes(tweetContent)} bytes):`);
      console.log(tweetContent);
      return res.status(200).send(`[DRY RUN] Tweet content: ${tweetContent}`);
    }

    console.log(`[${runIdentifier}] Posting tweet...`);
    await twitterClient.postTweet(tweetContent);
    console.log(`[${runIdentifier}] Successfully posted tweet.`);

    res.status(200).send(`Tweeted: ${tweetContent}`);
  } catch (error) {
    console.error(`[${runIdentifier}] Error in handler:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).send(`Error: ${errorMessage}`);
  }
};

export default handler;