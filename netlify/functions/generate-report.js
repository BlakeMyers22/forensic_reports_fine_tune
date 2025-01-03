const OpenAI = require('openai');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Function to get weather data from Visual Crossing
async function getWeatherData(location, date) {
  try {
    const response = await axios.get(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(location)}/${date}`, {
      params: {
        unitGroup: 'us',
        key: process.env.WEATHER_API_KEY,
        include: 'hours'
      }
    });

    const dayData = response.data.days[0];
    const hourlyData = dayData.hours;

    const maxWindGust = Math.max(...hourlyData.map(hour => hour.windgust || 0));
    const maxWindTime = hourlyData.find(hour => hour.windgust === maxWindGust)?.datetime || 'N/A';

    return {
      success: true,
      data: {
        maxTemp: `${dayData.tempmax}°F`,
        minTemp: `${dayData.tempmin}°F`,
        avgTemp: `${dayData.temp}°F`,
        maxWindGust: `${maxWindGust} mph`,
        maxWindTime: maxWindTime,
        totalPrecip: `${dayData.precip} inches`,
        humidity: `${dayData.humidity}%`,
        conditions: dayData.conditions,
        hailPossible: dayData.preciptype?.includes('hail') ? 'Yes' : 'No',
        thunderstorm: dayData.preciptype?.includes('thunder') ? 'Yes' : 'No'
      }
    };
  } catch (error) {
    console.error('Weather API Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Function to get latest fine-tuned model ID
async function getLatestModelId() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const configCollection = client.db('forensic-reports').collection('config');
        const config = await configCollection.findOne({ key: 'latest_model' });
        return config?.modelId || 'gpt-3';  // Fallback to base model
    } catch (error) {
        console.error('Error fetching latest model ID:', error);
        return 'gpt-4o-2024-08-06'; // Fallback to base model
    } finally {
        await client.close();
    }
}

// Function to generate section content
async function generateSection(sectionName, context, customInstructions = '') {
    const modelId = await getLatestModelId();
    const weatherData = await getWeatherData(context.location, context.dateOfLoss);
    
    const sectionPrompts = {
        'authorization': `Generate the "Authorization and Scope of Investigation" section for a forensic engineering report with:
        - Investigation Date: ${context.investigationDate}
        - Property Location: ${context.location}
        - Client Name: ${context.clientName}
        - Date of Loss: ${context.dateOfLoss}
        
        Follow professional engineering report standards and include scope of investigation, photo documentation, and references to appendices.`,

        'background': `Generate the "Background Information" section for a forensic engineering report with:
        - Property Type: ${context.propertyType}
        - Age: ${context.propertyAge} years
        - Construction: ${context.constructionType}
        - Current Use: ${context.currentUse}
        - Square Footage: ${context.squareFootage}

        Include detailed description of building construction, materials, architectural features, and current usage.`,

        'observations': `Generate the "Site Observations and Analysis" section for:
        - Components: ${context.affectedAreas.join(', ')}
        - Damage Type: ${context.claimType}
        - Engineer Notes: ${context.engineerNotes}
        - Weather Conditions: ${JSON.stringify(weatherData.data)}

        Provide detailed analysis of each affected component with technical observations and damage patterns.`,

        'moisture': `Generate the "Moisture Survey" section describing:
        - Investigation Date: ${context.investigationDate}
        - Survey Methodology
        - Equipment Used
        - Findings Overview
        Reference Appendix B for detailed results.`,

        'meteorologist': `Generate the "Meteorologist Report" section analyzing:
        Weather Data: ${JSON.stringify(weatherData.data)}
        Date of Loss: ${context.dateOfLoss}
        
        Analyze weather conditions impact on observed damage patterns.`,

        'conclusions': `Generate "Conclusions and Recommendations" based on:
        - Damage Type: ${context.claimType}
        - Weather Data: ${JSON.stringify(weatherData.data)}
        - Affected Areas: ${context.affectedAreas.join(', ')}
        - Investigation Findings: ${context.engineerNotes}

        Provide clear conclusions and specific repair recommendations.`,

        'rebuttal': `Generate the "Rebuttal" section addressing:
        - Our Investigation Date: ${context.investigationDate}
        - Our Findings: Based on collected evidence
        
        Maintain professional tone while addressing technical disagreements.`,

        'limitations': `Generate the "Limitations" section including:
        1. Scope limitations
        2. Information availability
        3. Scientific/engineering certainty
        4. Examination conditions
        5. Confidentiality statement
        6. Report use restrictions`
    };

    const basePrompt = sectionPrompts[sectionName.toLowerCase()];
    const finalPrompt = customInstructions 
        ? `${basePrompt}\n\nAdditional Instructions: ${customInstructions}`
        : basePrompt;

    const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
            {
                role: 'system',
                content: 'You are an expert forensic engineer generating professional report sections. Follow the example report format while maintaining formal technical language and detailed analysis. Include specific measurements, observations, and technical justifications for all conclusions.'
            },
            {
                role: 'user',
                content: finalPrompt
            }
        ],
        temperature: 0.7,
        max_tokens: 1000
    });

    return completion.choices[0].message.content;
}

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { section, context, customInstructions } = JSON.parse(event.body);
        
        const content = await generateSection(
            section, 
            context, 
            customInstructions
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                section: content,
                sectionName: section
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to generate report section',
                details: error.message
            })
        };
    }
};
