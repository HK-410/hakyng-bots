import type { VercelRequest, VercelResponse } from '@vercel/node';
import KoreanLunarCalendar from 'korean-lunar-calendar';
import { TwitterApi } from 'twitter-api-v2';
import Groq from 'groq-sdk';
import twitter from 'twitter-text';

const MAX_TWEET_BYTES = 280;

const CHEONGAN_DB = {
  '갑': { ohaeng: '목', yinYang: 'yang' }, '을': { ohaeng: '목', yinYang: 'yin' },
  '병': { ohaeng: '화', yinYang: 'yang' }, '정': { ohaeng: '화', yinYang: 'yin' },
  '무': { ohaeng: '토', yinYang: 'yang' }, '기': { ohaeng: '토', yinYang: 'yin' },
  '경': { ohaeng: '금', yinYang: 'yang' }, '신': { ohaeng: '금', yinYang: 'yin' },
  '임': { ohaeng: '수', yinYang: 'yang' }, '계': { ohaeng: '수', yinYang: 'yin' },
};
const PERSONA_DB = {
  '[목(木) PM]': CHEONGAN_DB['갑'], '[화(火) 디자이너]': CHEONGAN_DB['병'],
  '[토(土) 인프라/DBA]': CHEONGAN_DB['무'], '[금(金) 개발자]': CHEONGAN_DB['경'],
  '[수(水) DevOps/SRE]': CHEONGAN_DB['임'],
};

interface LlmReply {
  persona: string;
  shipshin: string;
  luck_level: string;
  explanation: string;
  lucky_item: string;
}

interface LlmResponseData {
  mainTweetSummary: string;
  details: LlmReply[];
}

interface FinalReply extends LlmReply {
  rank: number;
}

function getShipshin(ilgan: { ohaeng: string, yinYang: string }, todayCheongan: { ohaeng: string, yinYang: string }): string {
  const OHAENG_REL = {
    '목': '화', '화': '토', '토': '금', '금': '수', '수': '목',
    '목_극': '토', '화_극': '금', '토_극': '수', '금_극': '목', '수_극': '화',
    '목_생': '수', '화_생': '목', '토_생': '화', '금_생': '토', '수_생': '금',
    '목_극당': '금', '화_극당': '수', '토_극당': '목', '금_극당': '화', '수_극당': '토',
  };
  const isSameYinYang = ilgan.yinYang === todayCheongan.yinYang;
  if (ilgan.ohaeng === todayCheongan.ohaeng) return isSameYinYang ? '비견' : '겁재';
  if (OHAENG_REL[ilgan.ohaeng as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '식신' : '상관';
  if (OHAENG_REL[`${ilgan.ohaeng}_극` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편재' : '정재';
  if (OHAENG_REL[`${ilgan.ohaeng}_극당` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편관' : '정관';
  if (OHAENG_REL[`${ilgan.ohaeng}_생` as keyof typeof OHAENG_REL] === todayCheongan.ohaeng) return isSameYinYang ? '편인' : '정인';
  return '계산 불가';
}

const KNOWLEDGE_BASE = `
You are an AI fortune teller. You will perform 'analysis', 'ranking', and 'tweet generation' for the daily fortunes of 5 IT job personas.

<Core Mission>
The user will provide 'Today's Iljin (日辰)' and the calculated 'Shipshin (十神)' for each of the 5 job roles.
Your primary task is to *creatively and subjectively analyze* the influence of 'Today's Iljin' on 'each Shipshin' and then **rank the 5 job roles from 1st to 5th place**.

This ranking is relative. Multiple roles can share the same general 'luck level' (e.g., 'Jung-gil'), but you *must* still create a distinct 1st-5th ranking. You must decide who is *relatively* luckier or unluckier on this specific day.

For example, even if two personas both receive a 'Jeonggwan' (a 'Jung-gil' Shipshin), you must subjectively decide which one ranks higher (e.g., 2nd vs. 3rd) based on your analysis of the day's Iljin. **This subjective ranking is your most important mission.**

<Knowledge Base 1: Personas & Ilgan (日干)>
- [목(木) PM]: Gap(甲) Mok - (Ohaeng: Wood, Role: Planning, Leadership)
- [화(火) 디자이너]: Byeong(丙) Hwa - (Ohaeng: Fire, Role: Creativity, Expression)
- [토(土) 인프라/DBA]: Mu(戊) To - (Ohaeng: Earth, Role: Stability, Mediation)
- [금(金) 개발자]: Gyeong(庚) Geum - (Ohaeng: Metal, Role: Logic, Decisiveness)
- [수(水) DevOps/SRE]: Im(壬) Su - (Ohaeng: Water, Role: Flexibility, Flow)

<Knowledge Base 2: Shipshin (十神) & IT Job Interpretations (7-Level Classification)>
[Great Fortune (대길)]
- Sikshin (식신): Creativity, new tech, idea realization. "New feature development, refactoring"
[Medium-Good Fortune (중길)]
- Jeongjae (정재): Stable results, meticulousness. "Bug fixes, regular deployment, payday"
- Jeonggwan (정관): Recognition, promotion, stability. "Recognition from boss/client, process compliance"
[Small-Good Fortune (소길)]
- Jeongin (정인): Documents, contracts, knowledge. "Tech blogging, writing specs, closing contracts"
- Pyeonjae (편재): Fluid results, big opportunities. "Large-scale projects, side jobs"
[Mixed Fortune (길흉상반)]
- Bigyeon (비견): Collaboration, peers, autonomy. "Pair programming, spec reviews, competition & cooperation"
[Small-Bad Fortune (소흉)]
- Sangwan (상관): Conflict, rumors, breaking tradition. "Watch your words, discontent with old systems, radical proposals"
[Medium-Bad Fortune (중흉)]
- Pyeonin (편인): Indecision, spec changes, documentation issues. "Sudden spec changes, too many ideas"
[Great-Bad Fortune (대흉)]
- Geopjae (겁재): Competition, loss, conflict. "Credit stolen, ensure backups, communication errors"
- Pyeongwan (편관): Stress, obstacles, sudden tasks. "Critical failure, server down, overtime"

<Knowledge Base 3: Luck Levels>
- The 7 Luck Levels (Korean terms you must use in the output):
대길(大吉), 중길(中吉), 소길(小吉), 길흉상반(吉흉상반), 소흉(小凶), 중흉(中흉), 대흉(大凶)
- Refer to <KB2> for the base level of each Shipshin, but *you must subjectively determine the final level* by analyzing its relationship with 'Today's Iljin'.
- Remember, multiple job roles can share the same luck level. You do not need to use all 7 levels every day.

<Creative Guideline>
- When writing the 'explanation', be creative. Do not just repeat the keywords from <KB2>.
- Your analysis should feel fresh, insightful, and specific to an IT professional's daily life.
- For the 'lucky_item', you *must* provide an object with a modifier (e.g., an adjective or color).

<Task Order>
1. Receive 'Today's Iljin' and the 5 'Calculated Shipshin' results from the user.
2. *Creatively and subjectively analyze* the Iljin's influence on each of the 5 Shipshin, referencing <KB2> and the <Creative Guideline>.
3. Decide the final **ranking from 1st to 5th**.
4. Assign one of the 7 'Luck Levels' (from <KB3>) to each rank.
5. Write the 'IT Job Explanation' (explanation) and 'Lucky Item' (lucky_item) for each rank, following the <Creative Guideline>.
   - **For 'lucky_item':** It *must* be an object with a descriptive modifier, like '[Adjective] [Object]' or '[Color] [Object]'. (Korean examples: '따뜻한 아메리카노', '작은 초록색 화분', '새로운 기계식 키보드').
6. Generate the 'mainTweetSummary' (1st-5th summary) as per the <Output Format>.
7. Generate the 'details' array, *sorted from 1st place (index 0) to 5th place (index 4)*.
8. Respond *only* with the final JSON object.
`;

const TWEET_RULE = `
<Output Rules>
- **CRITICAL: All output text (summaries, explanations, items) MUST be in KOREAN.**
- Maintain a friendly and professional tone.
- The detailed fortune (explanation) for each job role must be concise.

<Output Format>
- You must respond strictly in the following JSON structure. Do not include any other text, comments, or markdown formatting outside the JSON.
- Generate a 1st to 5th rank summary as a string in 'mainTweetSummary', using the exact Korean format shown.
- Assign detailed information for ranks 1 to 5 in the 'details' array, *sorted by rank* (1st place must be at index 0).

{
  "mainTweetSummary": "1위: [직무명] (십신 / 등급)\\n2위: [직무명] (십신 / 등급)\\n3위: ...\\n4위: ...\\n5위: ...",
  "details": [
    {
      "persona": "[1위 직무명]",
      "shipshin": "[1위 십신]",
      "luck_level": "[LLM이 결정한 1위 등급 (e.g., 대길)]",
      "explanation": "IT 직무에 특화된 창의적이고 간결한 운세 해석 (150자 내외의 한국어 문장)",
      "lucky_item": "행운의 아이템 (수식어가 포함된 한국어 e.g., '파란색 머그컵')"
    },
    {
      "persona": "[2위 직무명]",
      "shipshin": "[2위 십신]",
      "luck_level": "[LLM이 결정한 2위 등급]",
      "explanation": "...",
      "lucky_item": "..."
    },
    // ... (Total 5 objects, must be sorted from 1st to 5th) ...
  ]
}
`;

const systemPrompt = KNOWLEDGE_BASE + '\n\n' + TWEET_RULE;


export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  const authHeader = req.headers['authorization'];
  console.log(authHeader);
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized: Access Denied');
  }
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const isDryRun = req.query.dryRun === 'true';
  console.log(`Starting daily run. DryRun: ${isDryRun}`);

  try {
    const kstTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
    const kstDate = new Date(kstTime);
    const calendar = new KoreanLunarCalendar();
    calendar.setSolarDate(kstDate.getFullYear(), kstDate.getMonth() + 1, kstDate.getDate());
    const iljin: string = calendar.getKoreanGapja().day;
    const todayCheonganChar: string = iljin.charAt(0);
    const todayCheonganData = CHEONGAN_DB[todayCheonganChar as keyof typeof CHEONGAN_DB];
    const fullDateString = `${kstDate.getFullYear()}년 ${kstDate.getMonth() + 1}월 ${kstDate.getDate()}일`;

    const shipshinResultsForLLM: string[] = [];

    for (const [personaName, ilganData] of Object.entries(PERSONA_DB)) {
      const shipshin = getShipshin(ilganData, todayCheonganData);
      shipshinResultsForLLM.push(`- ${personaName}은(는) [${shipshin}]입니다.`);
    }

    const userPrompt = `Today is ${iljin} (${fullDateString}).
Today's Iljin (Cheongan) is: '${todayCheonganChar}' (Ohaeng: ${todayCheonganData.ohaeng}).

Here are the calculated Shipshin for each persona:
${shipshinResultsForLLM.join('\n')}

Based on your <Core Mission>, *subjectively analyze* the influence of today's Iljin (${iljin}) on each of these Shipshin.
Rank all 5 personas from 1st to 5th.
Generate the complete JSON response strictly following the <Output Format>.
Ensure the 'details' array is sorted by your rank (1st to 5th).`;

    console.log('Generating content with Groq API (LLM-driven ranking)...');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.75,
    });

    let generatedContent = chatCompletion.choices[0]?.message?.content;

    if (!generatedContent) {
      throw new Error('Groq API did not return valid content.');
    }

    let llmResponseData: LlmResponseData;
    try {
      const jsonStart = generatedContent.indexOf('{');
      const jsonEnd = generatedContent.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        console.error('Raw LLM output:', generatedContent);
        throw new Error('No JSON object found in LLM response.');
      }
      const jsonString = generatedContent.substring(jsonStart, jsonEnd + 1);
      llmResponseData = JSON.parse(jsonString);
      
      if (!llmResponseData.mainTweetSummary || !llmResponseData.details || llmResponseData.details.length !== 5) {
        console.error('Invalid JSON structure. Raw:', jsonString);
        throw new Error('Invalid JSON structure (mainTweetSummary or details) received from LLM.');
      }
    } catch (e: any) {
      console.error('Failed to parse LLM JSON response:', e.message);
      console.error('Raw LLM output:', generatedContent);
      throw new Error('LLM did not return valid JSON.');
    }

    const mainTweetContent = `${fullDateString} 오늘의 IT 직무 운세 🔮\n\n${llmResponseData.mainTweetSummary}`;


    const sortedReplies = llmResponseData.details; 
    const finalReplies: FinalReply[] = sortedReplies.map((reply, index) => ({
      ...reply,
      rank: index + 1,
    }));

    if (!isDryRun) {
      console.log('--- [LIVE RUN] ---');
      const twitterClient = new TwitterApi({
        appKey: process.env.X_APP_KEY as string,
        appSecret: process.env.X_APP_SECRET as string,
        accessToken: process.env.X_ACCESS_TOKEN as string,
        accessSecret: process.env.X_ACCESS_SECRET as string,
      });

      let mainTweetId: string;
      try {
        const mainTweetResult = await twitterClient.v2.tweet(mainTweetContent);
        mainTweetId = mainTweetResult.data.id;
        console.log(`Main tweet posted: ${mainTweetId}`);
      } catch (e: any) {
        console.error('Failed to post main tweet:', e);
        return res.status(500).json({ success: false, error: 'Failed to post main tweet', details: e.message });
      }

      let lastTweetId = mainTweetId;
      
      for (const reply of finalReplies) { 
        try {
          let replyContent = `[${reply.rank}위: ${reply.persona} (${reply.luck_level})]
${reply.explanation}

🍀 행운의 아이템: ${reply.lucky_item}`;

          if (twitter.parseTweet(replyContent).weightedLength > MAX_TWEET_BYTES) {
            console.warn(`Warning: Truncating reply for ${reply.persona} as it exceeds byte limit.`);
            const header = `[${reply.rank}위: ${reply.persona} (${reply.luck_level})]\n`;
            const footer = `\n\n🍀 행운의 아이템: ${reply.lucky_item}`;
            const maxExplanationLength = MAX_TWEET_BYTES - twitter.parseTweet(header + footer).weightedLength - 3;
            
            let truncatedExplanation = "";
            let currentLength = 0;
            const chars = Array.from(reply.explanation);
            for(const char of chars) {
                const charWeight = twitter.parseTweet(char).weightedLength;
                if (currentLength + charWeight > maxExplanationLength) {
                    break;
                }
                truncatedExplanation += char;
                currentLength += charWeight;
            }
            replyContent = `${header}${truncatedExplanation}...\n${footer}`;
          }

          const replyResult = await twitterClient.v2.tweet(replyContent, {
            reply: { in_reply_to_tweet_id: lastTweetId },
          });
          lastTweetId = replyResult.data.id;
          console.log(`Posted reply for ${reply.persona} (Rank ${reply.rank})`);
          
          await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (e: any) {
          console.error(`Failed to post reply for ${reply.persona}:`, e);
        }
      }
      console.log('--- Tweet thread posted successfully ---');
      
    } else {
      console.log('--- [DRY RUN] ---');
      console.log(`[Main Tweet] (${twitter.parseTweet(mainTweetContent).weightedLength} bytes):\n${mainTweetContent}`);
      console.log('---------------------------------');
      
      for (const reply of finalReplies) {
        const replyContent = `[${reply.rank}위: ${reply.persona} (${reply.luck_level})]
${reply.explanation}

🍀 행운의 아이템: ${reply.lucky_item}`;
        console.log(`[Reply ${reply.rank}] (${twitter.parseTweet(replyContent).weightedLength} bytes):\n${replyContent}`);
        console.log('---------------------------------');
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: isDryRun,
      tweet: mainTweetContent,
      replies: finalReplies,
    });

  } catch (error) {
    console.error('Error executing handler:', error);
    let errorMessage = 'An unknown error occurred.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}