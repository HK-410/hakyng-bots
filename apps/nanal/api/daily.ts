import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
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

    // 3. Get current date
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset);
    const month = kstDate.toLocaleString('en-US', { month: 'long' });
    const day = kstDate.getUTCDate();
    const dateString = `${month} ${day}`;
    console.log(`[${runIdentifier}] Target date (KST): ${dateString}`);

    let observances: string[] = [];

    // 4. Fetch data from Wikipedia API
    console.log(`[${runIdentifier}] Attempting to fetch observances from Wikipedia for ${dateString}...`);
    try {
      const headers = { 
        'User-Agent': 'NaNalBot/1.0 (https://github.com/HK-410/hakyng-bots/tree/main/apps/nanal/; hakyung410+nanalbot@gmail.com)' 
      };
      const sectionsUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${dateString}&prop=sections&format=json`;
      const sectionsResponse = await axios.get(sectionsUrl, { headers });
      const sections = sectionsResponse.data.parse.sections;
      const holidaySection = sections.find((s: any) => s.line === 'Holidays and observances');

      if (holidaySection) {
        const sectionIndex = holidaySection.index;
        const contentUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${dateString}&prop=text&section=${sectionIndex}&format=json`;
        const contentResponse = await axios.get(contentUrl, { headers });
        const htmlContent = contentResponse.data.parse.text['*'];
        const $ = cheerio.load(htmlContent);
        
        $('li').each((i, el) => {
          const text = $(el).text().trim();
          if (text) observances.push(text);
        });
      }
      console.log(`[${runIdentifier}] Wikipedia fetch result: Found ${observances.length} observances.`);
    } catch (apiError) {
      console.error(`[${runIdentifier}] Wikipedia API fetch failed:`, apiError);
    }

    // 5. Generate tweet with Groq LLM
    const dataSourceLog = observances.length > 0 ? 'Wikipedia' : 'Fallback (invented day)';
    console.log(`[${runIdentifier}] Generating tweet content. Data source for LLM: ${dataSourceLog}.`);
    const systemPrompt = `
You are "나날(NaNal)", a witty bot that tweets about today's date.

<Your Goal>
Create a single, focused tweet in Korean, under 280 characters. Your tweet should have ONE main theme and, if relevant, one or two related fun facts. Avoid just listing things.

<How to Choose the Theme>
Analyze the provided list of observances and pick the main theme using this priority:
1.  **Korean Holiday:** If one exists, it's your main theme.
2.  **Famous Global Holiday:** If no Korean holiday, pick a globally recognized one.
3.  **Most Interesting Topic:** If neither of the above, pick the most fun or quirky topic from the list.
4.  **Creative Fallback:** If the list is empty, invent a fun, special day for today.

<How to Write the Tweet>
- Focus on the main theme you chose.
- You can add one or two other interesting observances from the list as secondary fun facts, but don't let them distract from the main theme.
- Tell a small story or share a fun perspective. Start with an engaging opening like "11월 10일, 오늘은..."
- The tweet MUST NOT contain any hashtags.
`;
    const userPrompt = `Today is ${dateString}. Here is the list of observances:\n- ${observances.join('\n- ')}\n\nFollow the instructions to create a tweet.`;

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
      console.log(`[${runIdentifier}] Tweet content for ${dateString} (${twitterClient.calculateBytes(tweetContent)} bytes):`);
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