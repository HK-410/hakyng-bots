import axios from 'axios';
import { TwitterClient } from '@hakyung/x-bot-toolkit';

import type { NextApiRequest, NextApiResponse } from "next";

interface ForecastResponseData {
  list: Array<{dt: number, main: {temp_min: number, temp_max: number}, weather: Array<{description: string}>}>
}

interface WeatherData {
  temp: {
    min: undefined | number,
    max: undefined | number,
  },
  weather: undefined | string,
}

const WEATHER_DICTIONARY: {[key: string]: {
  importance: number,
  icon: string,
}} = {
  "clear sky": {
      importance: 0,
      icon: "☀️",
  },
  "few clouds": {
      importance: 1,
      icon: "🌤",
  },
  "scattered clouds": {
      importance: 2,
      icon: "⛅",
  },
  "broken clouds": {
      importance: 3,
      icon: "🌥",
  },
  "mist": {
      importance: 4,
      icon: "🌫",
  },
  "shower rain": {
      importance: 5,
      icon: "🌦",
  },
  "rain": {
      importance: 6,
      icon: "🌧",
  },
  "thunderstorm": {
      importance: 7,
      icon: "⛈️",
  },
  "snow": {
      importance: 8,
      icon: "☃️",
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const runIdentifier = Math.random().toString(36).substring(7);
  console.log(`[${runIdentifier}] Function start.`);

  console.log(req.headers['authorization']?.split(' ')[1])
  console.log(process.env.CRON_SECRET)

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
    const twitterClient = new TwitterClient({
      appKey: process.env.X_APP_KEY!,
      appSecret: process.env.X_APP_SECRET!,
      accessToken: process.env.X_ACCESS_TOKEN!,
      accessSecret: process.env.X_ACCESS_SECRET!,
    });
    console.log(`[${runIdentifier}] Clients initialized.`);

    // 3. Get weather data
    const kstTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
    const kstDate = new Date(kstTime);
    const today = kstDate.getUTCDate();
    const fullDateString = `${kstDate.getUTCFullYear()}년 ${kstDate.getUTCMonth() + 1}월 ${kstDate.getUTCDate()}일`;

    const weatherData: {[key: string]: WeatherData} = {
      seoul: {
        temp: {
          min: undefined,
          max: undefined,
        },
        weather: undefined,
      },
      busan: {
        temp: {
          min: undefined,
          max: undefined,
        },
        weather: undefined,
      },
      pyongyang: {
        temp: {
          min: undefined,
          max: undefined,
        },
        weather: undefined,
      },
    }

    console.log(`[${runIdentifier}] Attempting to fetch weather from OpenWeatherMap`);
    try {
      const headers = { 
        'User-Agent': 'WeatherFairyBot/1.0 (https://github.com/HK-410/hakyng-bots/tree/main/apps/weatherfairy/; hakyung410+weatherfairy@gmail.com)' 
      };
      const seoulResponse = await axios.get(`http://api.openweathermap.org/data/2.5/forecast?q=Seoul&appid=${process.env.OPENWEATHERMAP_API_KEY}&lang=en&units=metric`, { headers });
      const seoulForecast: ForecastResponseData = seoulResponse.data;
      for (const forecast of seoulForecast.list) {
        const forecastTimeInKST = new Date(new Date(forecast.dt * 1000).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        if (forecastTimeInKST.getUTCDate() !== today) continue;
        if (!weatherData.seoul.temp.min || forecast.main.temp_min < weatherData.seoul.temp.min) weatherData.seoul.temp.min = forecast.main.temp_min;
        if (!weatherData.seoul.temp.max || weatherData.seoul.temp.max < forecast.main.temp_max) weatherData.seoul.temp.max = forecast.main.temp_max;
        for (const weatherInForecast of forecast.weather) {
          if (WEATHER_DICTIONARY[weatherInForecast.description]&& (!weatherData.seoul.weather || WEATHER_DICTIONARY[weatherData.seoul.weather].importance < WEATHER_DICTIONARY[weatherInForecast.description].importance)) weatherData.seoul.weather = weatherInForecast.description;
        }
      }
      const busanResponse = await axios.get(`http://api.openweathermap.org/data/2.5/forecast?q=Busan&appid=${process.env.OPENWEATHERMAP_API_KEY}&lang=en&units=metric`, { headers });
      const busanForecast: ForecastResponseData = busanResponse.data;
      for (const forecast of busanForecast.list) {
        const forecastTimeInKST = new Date(new Date(forecast.dt * 1000).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        if (forecastTimeInKST.getUTCDate() !== today) continue;
        if (!weatherData.busan.temp.min || forecast.main.temp_min < weatherData.busan.temp.min) weatherData.busan.temp.min = forecast.main.temp_min;
        if (!weatherData.busan.temp.max || weatherData.busan.temp.max < forecast.main.temp_max) weatherData.busan.temp.max = forecast.main.temp_max;
        for (const weatherInForecast of forecast.weather) {
          if (WEATHER_DICTIONARY[weatherInForecast.description]&& (!weatherData.busan.weather || WEATHER_DICTIONARY[weatherData.busan.weather].importance < WEATHER_DICTIONARY[weatherInForecast.description].importance)) weatherData.busan.weather = weatherInForecast.description;
        }
      }
      const pyongyangResponse = await axios.get(`http://api.openweathermap.org/data/2.5/forecast?q=Pyongyang&appid=${process.env.OPENWEATHERMAP_API_KEY}&lang=en&units=metric`, { headers });
      const pyongyangForecast: ForecastResponseData = pyongyangResponse.data;
      for (const forecast of pyongyangForecast.list) {
        const forecastTimeInKST = new Date(new Date(forecast.dt * 1000).toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        if (forecastTimeInKST.getUTCDate() !== today) continue;
        if (!weatherData.pyongyang.temp.min || forecast.main.temp_min < weatherData.pyongyang.temp.min) weatherData.pyongyang.temp.min = forecast.main.temp_min;
        if (!weatherData.pyongyang.temp.max || weatherData.pyongyang.temp.max < forecast.main.temp_max) weatherData.pyongyang.temp.max = forecast.main.temp_max;
        for (const weatherInForecast of forecast.weather) {
          if (WEATHER_DICTIONARY[weatherInForecast.description]&& (!weatherData.pyongyang.weather || WEATHER_DICTIONARY[weatherData.pyongyang.weather].importance < WEATHER_DICTIONARY[weatherInForecast.description].importance)) weatherData.pyongyang.weather = weatherInForecast.description;
        }
      }
    } catch (apiError) {
      console.error(`[${runIdentifier}] OpenWeatherMap API fetch failed:`, apiError);
    }

    // 4. Generate tweet content
    const tweetContent = `${fullDateString}
서울 ${weatherData.seoul.weather ? WEATHER_DICTIONARY[weatherData.seoul.weather].icon : "❓"} - 최고: ${undefined !== weatherData.seoul.temp.max ? Math.round(weatherData.seoul.temp.max) : "❓"}℃ | 최저: ${undefined !== weatherData.seoul.temp.min ? Math.round(weatherData.seoul.temp.min) : "❓"}℃
부산 ${weatherData.busan.weather ? WEATHER_DICTIONARY[weatherData.busan.weather].icon : "❓"} - 최고: ${undefined !== weatherData.busan.temp.max ? Math.round(weatherData.busan.temp.max) : "❓"}℃ | 최저: ${undefined !== weatherData.busan.temp.min ? Math.round(weatherData.busan.temp.min) : "❓"}℃
평양 ${weatherData.pyongyang.weather ? WEATHER_DICTIONARY[weatherData.pyongyang.weather].icon : "❓"} - 최고: ${undefined !== weatherData.pyongyang.temp.max ? Math.round(weatherData.pyongyang.temp.max) : "❓"}℃ | 최저: ${undefined !== weatherData.pyongyang.temp.min ? Math.round(weatherData.pyongyang.temp.min) : "❓"}℃`;

    // 5. Post to Twitter (or log for dry run)
    if (isDryRun) {
      console.log(`[${runIdentifier}] --- DRY RUN ---`);
      console.log(`[${runIdentifier}] Tweet content (${twitterClient.calculateBytes(tweetContent)} bytes):`);
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
