import { TwitterApi } from 'twitter-api-v2';
import twitter from 'twitter-text';

const MAX_TWEET_BYTES = 280;

export interface TwitterClientConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

/**
 * A client for interacting with the Twitter API v2.
 */
export class TwitterClient {
  private client: TwitterApi;

  /**
   * Creates an instance of TwitterClient.
   * @param config The configuration object containing API keys and tokens.
   */
  constructor(config: TwitterClientConfig) {
    if (!config.appKey || !config.appSecret || !config.accessToken || !config.accessSecret) {
      throw new Error('Twitter API configuration is incomplete.');
    }
    this.client = new TwitterApi(config);
  }

  /**
   * Posts a single tweet, truncating it if it exceeds the byte limit.
   * @param content The content of the tweet.
   * @returns The ID of the posted tweet.
   */
  async postTweet(content: string): Promise<string> {
    const callIdentifier = Math.random().toString(36).substring(7);
    console.log(`[TwitterClient-${callIdentifier}] postTweet called.`);
    console.log(`[TwitterClient-${callIdentifier}]   Original Content (truncated): ${content}`);

    let finalContent = content;

    if (this.calculateBytes(finalContent) > MAX_TWEET_BYTES) {
      console.warn(`[TwitterClient-${callIdentifier}] Warning: Truncating tweet as it exceeds byte limit.`);
      const ellipsis = '...';
      const maxLength = MAX_TWEET_BYTES - this.calculateBytes(ellipsis);
      
      let truncatedText = "";
      let currentLength = 0;
      const chars = Array.from(finalContent);
      for(const char of chars) {
          const charWeight = this.calculateBytes(char);
          if (currentLength + charWeight > maxLength) {
              break;
          }
          truncatedText += char;
          currentLength += charWeight;
      }
      finalContent = truncatedText + ellipsis;
      console.log(`[TwitterClient-${callIdentifier}]   Truncated Content (truncated): ${finalContent}`);
    }

    try {
      const tweetResult = await this.client.v2.tweet(finalContent);
      console.log(`[TwitterClient-${callIdentifier}] Tweet posted: ${tweetResult.data.id}`);
      return tweetResult.data.id;
    } catch (e: any) {
      console.error(`[TwitterClient-${callIdentifier}] Failed to post tweet:`, e);
      throw new Error(`Failed to post tweet: ${e.message}`);
    }
  }

  /**
   * Posts a main tweet and a thread of replies.
   * @param mainTweetContent The content of the main tweet.
   * @param replies An array of strings for the reply thread.
   */
  async postThread(mainTweetContent: string, replies: string[]): Promise<void> {
    const callIdentifier = Math.random().toString(36).substring(7);
    console.log(`[TwitterClient-${callIdentifier}] postThread called.`);
    console.log(`[TwitterClient-${callIdentifier}]   Main Tweet Content (truncated): ${mainTweetContent}`);
    console.log(`[TwitterClient-${callIdentifier}]   Number of replies: ${replies.length}`);


    let mainTweetId: string;
    try {
      const mainTweetResult = await this.client.v2.tweet(mainTweetContent);
      mainTweetId = mainTweetResult.data.id;
      console.log(`[TwitterClient-${callIdentifier}] Main tweet posted: ${mainTweetId}`);
    } catch (e: any) {
      console.error(`[TwitterClient-${callIdentifier}] Failed to post main tweet:`, e);
      throw new Error(`Failed to post main tweet: ${e.message}`);
    }

    let lastTweetId = mainTweetId;

    for (const replyContent of replies) {
      try {
        let finalReplyContent = replyContent;
        console.log(`[TwitterClient-${callIdentifier}]   Original Reply Content (truncated): ${replyContent}`);


        if (this.calculateBytes(finalReplyContent) > MAX_TWEET_BYTES) {
          console.warn(`[TwitterClient-${callIdentifier}] Warning: Truncating reply as it exceeds byte limit.`);
          const ellipsis = '...';
          const maxLength = MAX_TWEET_BYTES - this.calculateBytes(ellipsis);
          
          let truncatedText = "";
          let currentLength = 0;
          const chars = Array.from(finalReplyContent);
          for(const char of chars) {
              const charWeight = this.calculateBytes(char);
              if (currentLength + charWeight > maxLength) {
                  break;
              }
              truncatedText += char;
              currentLength += charWeight;
          }
          finalReplyContent = truncatedText + ellipsis;
          console.log(`[TwitterClient-${callIdentifier}]   Truncated Reply Content (truncated): ${finalReplyContent}`);
        }

        const replyResult = await this.client.v2.tweet(finalReplyContent, {
          reply: { in_reply_to_tweet_id: lastTweetId },
        });
        lastTweetId = replyResult.data.id;
        console.log(`[TwitterClient-${callIdentifier}] Posted reply: ${lastTweetId}`);
        
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (e: any) {
        console.error(`[TwitterClient-${callIdentifier}] Failed to post a reply:`, e);
      }
    }
    console.log(`[TwitterClient-${callIdentifier}] --- Tweet thread posted successfully ---`);
  }

  /**
   * Calculates the weighted length of a tweet.
   * @param text The text of the tweet.
   * @returns The weighted length.
   */
  calculateBytes(text: string): number {
    return twitter.parseTweet(text).weightedLength;
  }
}
