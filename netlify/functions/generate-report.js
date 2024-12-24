const OpenAI = require('openai');
const { MongoClient } = require('mongodb');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Function to get latest fine-tuned model ID
async function getLatestModelId() {
    const client = new MongoClient(process.env.MONGODB_URI);
    try {
        await client.connect();
        const configCollection = client.db('forensic-reports').collection('config');
        const config = await configCollection.findOne({ key: 'latest_model' });
        return config?.modelId || 'gpt-4o-2024-08-06';  // Fallback to base model
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
    
    const sectionPrompts = {
        'authorization': `Generate the "Authorization and Scope of Investigation" section for a forensic engineering report with:
        - Investigation Date: ${context.investigationDate}
        - Property Location: ${context.location}
        - Client Name: ${context.clientName}
        - Date of Loss: ${context.dateOfLoss}
        
        Follow professional engineering report standards and include scope of investigation, photo documentation, and references to appendices.`,
        // ... [other section prompts will be added]
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
                content: 'You are an expert forensic engineer generating professional report sections. Maintain formal technical language and detailed analysis.'
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
