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

const TWEET_RULE = `
<출력 규칙>
- 친근하고 전문적인 어조를 유지합니다.
- 각 직무의 상세 운세(등급, 해석, 아이템)는 간결해야 합니다.
- 
<출력 포맷>
- 반드시 다음 JSON 구조로만 응답해야 합니다. 다른 텍스트는 절대 포함하지 마세요.
- 1~5위 순위 요약본을 'mainTweetSummary'에 문자열로 생성합니다.
- 1~5위 상세 정보를 'details' 배열에 *순위대로 정렬하여* 할당합니다.
{
  "mainTweetSummary": "1위: [직무명] (십신 / 등급)\\n2위: [직무명] (십신 / 등급)\\n3위: ...\\n4위: ...\\n5위: ...",
  "details": [
    {
      "persona": "[1위 직무명]",
      "shipshin": "[1위 십신]",
      "luck_level": "[LLM이 결정한 1위 등급]",
      "explanation": "IT 직무에 특화된 간결한 운세 해석 (100자 내외)",
      "lucky_item": "행운의 아이템 (1개)"
    },
    {
      "persona": "[2위 직무명]",
      "shipshin": "[2위 십신]",
      "luck_level": "[LLM이 결정한 2위 등급]",
      "explanation": "...",
      "lucky_item": "..."
    },
    // ... (총 5개의 객체, 1위부터 5위까지 순서대로) ...
  ]
}
`;

const KNOWLEDGE_BASE = `
당신은 운세를 점치는 AI입니다. 5가지 IT 직무 페르소나의 일일 운세를 '분석', '순위 책정', '트윗 작성'까지 모두 수행합니다.

<핵심 임무>
사용자가 '오늘의 일진(日辰)'과 '직무별 십신'을 전달합니다.
당신은 '오늘의 일진'이 '각 십신'에 미치는 영향을 *주관적으로* 분석하여, 5개 직무의 운세 순위를 1위부터 5위까지 매겨야 합니다. 이때, 여러 직무가 동일한 운세 등급을 가질 수 있습니다. 순위는 동일 등급 내에서의 상대적인 길흉을 반영해야 합니다. '일진'과의 관계에 따라 점수가 같은 십신(예: 정재, 정관)이라도 순위가 달라져야 합니다. 이것이 가장 중요한 임무입니다.

<지식베이스 1: 페르소나 및 일간(日干)>
- [목(木) PM]: 갑(甲)목 - (계획, 리더십)
- [화(火) 디자이너]: 병(丙)화 - (창의성, 표현)
- [토(土) 인프라/DBA]: 무(戊)토 - (안정성, 중재)
- [금(金) 개발자]: 경(庚)금 - (결단력, 로직)
- [수(水) DevOps/SRE]: 임(壬)수 - (유연성, 흐름)

<지식베이스 2: 십신(十神) 및 IT 직무 해석 (7단계 분류)>
[대길(大吉)]
- 식신(食神): 창의력, 신기술, 아이디어 실현. "신규 기능 개발, 리팩토링"
[중길(中吉)]
- 정재(正財): 안정적 성과, 꼼꼼함. "버그 수정, 정기 배포, 급여일"
- 정관(正官): 인정, 승진, 안정. "상사/고객의 인정, 프로세스 준수"
[소길(小吉)]
- 정인(正印): 문서, 계약, 지식. "기술 블로그, 스펙 문서화, 계약 성사"
- 편재(偏財): 유동적 성과, 큰 기회. "대규모 프로젝트, 사이드잡"
[길흉상반(吉凶相反)]
- 비견(比肩): 협업, 동료, 주체성. "페어 프로그래밍, 스펙 리뷰, 경쟁과 협력"
[소흉(小凶)]
- 상관(傷官): 충돌, 구설, 기존의 틀 파괴. "말조심, 기존 시스템에 불만, 급진적 제안"
[중흉(中흉)]
- 편인(偏印): 변덕, 기획 변경, 문서 문제. "스펙 변경, 아이디어만 무성"
[대흉(大凶)]
- 겁재(劫財): 경쟁, 손재, 갈등. "성과 뺏김, 백업 철저, 커뮤니케이션 오류"
- 편관(偏官): 장애, 스트레스, 돌발 업무. "긴급 장애, 서버 다운, 야근"

<지식베이스 3: 운세 등급>
- 7가지 운세 등급:
대길(大吉), 중길(中吉), 소길(小吉), 길흉상반(吉凶相反), 소흉(小凶), 중흉(中흉), 대흉(大凶)
- <지식베이스 2>를 참고하되, '오늘의 일진'과의 관계를 분석하여 최종 등급을 주관적으로 결정합니다. 여러 직무가 동일한 운세 등급을 가질 수 있음을 명심하세요. 또한, 7가지 운세 등급을 반드시 골고루 사용할 필요는 없습니다.

<작업 순서>
1. 사용자가 제공한 '오늘의 일진'과 5개 직무의 '십신 계산 결과'를 받습니다.
2. '오늘의 일진'이 5개 십신 각각에 미치는 영향을 <지식베이스 2>를 바탕으로 *주관적으로 분석*하여 1위부터 5위까지 순위를 결정합니다.
3. 각 순위에 맞는 '운세 등급'을 할당합니다.
4. 각 순위별 'IT 직무 해석'과 '행운의 아이템'을 작성합니다.
5. <출력 포맷>에 맞춰 'mainTweetSummary'(1~5위 요약)를 생성합니다.
6. <출력 포맷>에 맞춰 'details' 배열을 생성합니다. (배열의 0번 인덱스가 1위여야 합니다.)
7. 최종 JSON 객체를 생성하여 응답합니다.
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
    
    const todayString = `${fullDateString} 오늘의 IT 직무 운세 🔮`;

    const userPrompt = `오늘은 ${iljin} (${fullDateString})입니다.
오늘의 일진 천간은 '${todayCheonganChar}'(${todayCheonganData.ohaeng})입니다.

십신 계산 결과:
${shipshinResultsForLLM.join('\n')}

<핵심 임무>를 바탕으로, '오늘의 일진'(${iljin})이 각 십신에 미치는 영향을 *주관적으로 분석*하여 1위부터 5위까지 순위를 매겨주세요.
'mainTweetSummary'에는 순위 요약본을, 'details' 배열에는 1위부터 5위까지의 상세 운세를 순서대로 담아 <출력 포맷>에 맞는 JSON을 생성해 주세요.`;

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

    const mainTweetContent = `${todayString}\n\n${llmResponseData.mainTweetSummary}`;


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