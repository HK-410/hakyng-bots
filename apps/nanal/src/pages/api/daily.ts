import axios from 'axios';
import TurndownService from 'turndown';
import * as cheerio from 'cheerio';
import { GroqClient, TwitterClient } from '@hakyung/x-bot-toolkit';
import { getEventsForDate } from '@/data/events';

import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const runIdentifier = Math.random().toString(36).substring(7);
  console.log(`[${runIdentifier}] Function start.`);

  // 1. Authenticate cron job request
  if (req.headers['authorization']?.split(' ')[1] !== process.env.CRON_SECRET) {
    console.log(`[${runIdentifier}] Unauthorized access attempt.`);
    return res.status(401).send('Unauthorized');
  }
  if (req.method !== 'GET') {
    console.log(`[${runIdentifier}] Method not allowed: ${req.method}`);
    return res.status(405).send('Method Not Allowed');
  }

  const isDryRun = req.query.dryRun === 'true';
  console.log(`[${runIdentifier}] Run mode: dryRun=${isDryRun}`);

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
    const apiDateString = koreanDateString.replace(' ', '_');
    const dayOfWeek = kstDate.toLocaleString('ko-KR', { weekday: 'long' });
    console.log(`[${runIdentifier}] Target date (KST): ${year}년 ${koreanDateString}, Day of Week: ${dayOfWeek}`);

    const todaysSpecialEvents = getEventsForDate(kstDate);

    const formattedSpecialEvents = todaysSpecialEvents.map(event => {
        let eventString = `[${event.name}] ${event.description}`;
        if (event.startYear) {
            const anniversary = year - event.startYear;
            if (anniversary > 0) {
                eventString += ` 올해로 ${anniversary}주년입니다.`;
            }
        }
        return eventString;
    });

    if (formattedSpecialEvents.length > 0) {
      console.log(`[${runIdentifier}] Special event detected: ${formattedSpecialEvents.join(', ')}`);
    }

    let observances = '';

    // 4. Fetch data from Wikipedia API
    console.log(`[${runIdentifier}] Attempting to fetch observances from Wikipedia for ${apiDateString}`);
    try {
      const headers = { 
        'User-Agent': 'NaNalBot/1.0 (https://github.com/HK-410/hakyng-bots/tree/main/apps/nanal/; hakyung410+nanal@gmail.com)' 
      };
      const sectionsUrl = `https://ko.wikipedia.org/w/api.php?action=parse&page=${apiDateString}&prop=sections&format=json`;
      const sectionsResponse = await axios.get(sectionsUrl, { headers });
      const sections = sectionsResponse.data.parse.sections;
      const holidaySection = sections.find((s: any) => s.line === '기념일');

      if (holidaySection) {
        const sectionIndex = holidaySection.index;
        const contentUrl = `https://ko.wikipedia.org/w/api.php?action=parse&page=${apiDateString}&prop=text&section=${sectionIndex}&format=json`;
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
        
        if (contentHtml) {
          observances = turndownService.turndown(contentHtml);
        }
        console.log("result:::", observances);
      }
    } catch (apiError) {
      console.error(`[${runIdentifier}] Wikipedia API fetch failed:`, apiError);
    }

    const systemPrompt = `
You are "나날", an information bot that tweets facts about today's date.

<Your Goal>
Create a single, focused, and informative tweet in Korean, under 280 characters. Your tweet should have ONE main theme and, if relevant, one or two related fun facts. The current year will be provided. If the founding year of an event is clearly stated in the provided text, use it to calculate anniversaries (e.g., "N주년"). You will be given a list of observances from Wikipedia. Use this data to tell a compelling story about the day.

<How to Choose the Theme>
1.  **Analyze Observances & Categorize:** First, review the entire list of observances from Wikipedia. Categorize them into two groups:
    *   **Tier 1 (Must-Mention):** A list of all highly famous and culturally significant events for the day (e.g., for Nov 11, this would include Pepero Day, Singles' Day/Gwanggunjeol, and Navy Day).
    *   **Tier 2 (Interesting):** All other observances.
2.  **Prioritize the Main Theme:**
    *   **Priority 1 (Absolute): Special Event:** If a special event is provided (like the bot's birthday), it MUST be the main theme.
    *   **Priority 2: Most Significant Tier 1 Event:** If there's no special event, choose the MOST significant or well-known event from your "Tier 1" list to be the main theme.
    *   **Priority 3: Most Interesting Topic:** If the "Tier 1" list is empty, pick the most interesting topic from the "Tier 2" list to be the main theme.
    *   **Priority 4: Creative Fallback:** If all lists are empty, invent a fun, special day. In this case, humorously indicate that this day is a fictional creation (e.g., "나날 봇이 특별히 제정한...").

<How to Write the Tweet>
- **Focus on the main theme.**
- **Mandatory Inclusion Rule:** Your tweet MUST mention ALL events from the "Tier 1 (Must-Mention)" list you created. One will be the main theme, and the others should be included as key facts.
- **Anniversary Rule:** Only state the anniversary of an event (e.g., "50주년") if the founding year is explicitly mentioned in the provided Wikipedia data. Do not guess or infer the year.
- **Add Other Facts (Optional):** If space permits after including all Tier 1 events, you can add an interesting fact from the "Tier 2" list.
- State facts clearly and concisely.
- The tone must be neutral, objective, and informative.
- **CRITICAL: Avoid suggestive or conversational endings like '~해요', '~보세요', '~까요?'. Instead, use declarative endings like '~입니다', '~날입니다'.**
- Do not end the tweet with an ellipsis ("..."). Finish the sentence completely.
- The tweet MUST NOT contain any hashtags.
- Start the tweet with the format: "[Month]월 [Day]일, " (e.g., "11월 11일, ")
`;
    const userPrompt = `Today is ${year}년 ${koreanDateString} (${dayOfWeek}).
${formattedSpecialEvents.length > 0 ? `\n**Today's Special Events:**\n- ${formattedSpecialEvents.join('\n- ')}\n` : ''}
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
}
