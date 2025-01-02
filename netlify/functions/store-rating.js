const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    let client;
    try {
        console.log('Incoming request body:', event.body);
        const ratingData = JSON.parse(event.body);
        console.log('Parsed rating data:', ratingData);

        if (!ratingData.sectionId || !ratingData.rating || !ratingData.feedback) {
            throw new Error('Missing required fields: sectionId, rating, and feedback are required');
        }

        client = new MongoClient(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });

        await client.connect();
        console.log('MongoDB connected successfully');

        const db = client.db('forensic-reports');
        const ratingsCollection = db.collection('ratings');
        const highQualityCollection = db.collection('high-quality-examples');

        const trainingExample = {
            sectionId: ratingData.sectionId,
            rating: parseInt(ratingData.rating),
            feedback: ratingData.feedback,
            generatedContent: ratingData.generatedContent,
            context: ratingData.originalPrompt,
            timestamp: new Date(),
            trainingFormat: {
                messages: [
                    {
                        role: "system",
                        content: "You are an expert forensic engineer generating professional report sections."
                    },
                    {
                        role: "user",
                        content: ratingData.originalPrompt || ''
                    },
                    {
                        role: "assistant",
                        content: ratingData.generatedContent || ''
                    }
                ]
            }
        };

        const result = await ratingsCollection.insertOne(trainingExample);
        console.log('Rating stored with ID:', result.insertedId);

        let triggered_fine_tuning = false;
        if (ratingData.rating >= 6) {
            await highQualityCollection.insertOne(trainingExample);
            console.log('High-quality example stored');

            const highQualityCount = await highQualityCollection.countDocuments({
                timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            });

            if (highQualityCount >= 10) {
                console.log('Triggering fine-tuning process');
                try {
                    const finetuneResponse = await fetch(`${process.env.URL}/.netlify/functions/fine-tune-model`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ trigger: 'new_high_quality_examples' })
                    });

                    const finetuneResult = await finetuneResponse.json();

                    if (!finetuneResponse.ok) {
                        console.error('Fine-tuning trigger failed:', finetuneResult);
                    } else {
                        triggered_fine_tuning = true;
                        console.log('Fine-tuning triggered successfully:', finetuneResult);
                    }
                } catch (finetuneError) {
                    console.error('Error triggering fine-tuning:', finetuneError);
                }
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Rating stored successfully',
                ratingId: result.insertedId.toString(),
                triggered_fine_tuning,
                highQualityCount: highQualityCount || 0
            })
        };

    } catch (error) {
        console.error('Detailed error in store-rating:', {
            message: error.message,
            stack: error.stack,
            mongoState: client?.topology?.state
        });

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to store rating',
                details: error.message || 'Unknown error occurred',
                mongoState: client?.topology?.state
            })
        };
    } finally {
        if (client) {
            try {
                await client.close();
                console.log('MongoDB connection closed');
            } catch (closeError) {
                console.error('Error closing MongoDB connection:', closeError);
            }
        }
    }
};
