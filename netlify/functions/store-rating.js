const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Check method
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    let client;
    try {
        // Parse and validate input
        console.log('Incoming request body:', event.body);
        const ratingData = JSON.parse(event.body);
        console.log('Parsed rating data:', ratingData);

        // Validate required fields
        if (!ratingData.sectionId || !ratingData.rating || !ratingData.feedback) {
            throw new Error('Missing required fields: sectionId, rating, and feedback are required');
        }

        // Connect to MongoDB with robust options
        client = new MongoClient(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 30000
        });

        console.log('Attempting to connect to MongoDB...');
        await client.connect();
        console.log('MongoDB connected successfully');
        
        const db = client.db('forensic-reports');
        const ratingsCollection = db.collection('ratings');
        const highQualityCollection = db.collection('high-quality-examples');
        
        // Format the data for storage
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

        // Store rating
        const result = await ratingsCollection.insertOne(trainingExample);
        console.log('Rating stored with ID:', result.insertedId);

        // Handle high-quality examples
        let triggered_fine_tuning = false;
        let highQualityCount = 0;
        
        if (ratingData.rating >= 6) {
            await highQualityCollection.insertOne(trainingExample);
            console.log('High-quality example stored');
            
            // Check for fine-tuning trigger
            highQualityCount = await highQualityCollection.countDocuments({
                timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            });
            
            console.log('Current high-quality count:', highQualityCount);
            
            if (highQualityCount >= 10) {
                console.log('Triggering fine-tuning process');
                try {
                    const finetuneResponse = await fetch(`/.netlify/functions/fine-tune-model`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ trigger: 'new_high_quality_examples' })
                    });
                    
                    const finetuneResult = await finetuneResponse.json();
                    console.log('Fine-tuning response:', finetuneResult);
                    
                    if (!finetuneResponse.ok) {
                        console.error('Fine-tuning trigger failed:', finetuneResult);
                    } else {
                        triggered_fine_tuning = true;
                        console.log('Fine-tuning triggered successfully');
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
                highQualityCount
            })
        };

    } catch (error) {
        console.error('Detailed error in store-rating:', {
            message: error.message,
            stack: error.stack,
            mongoState: client?.topology?.state,
            connectionStatus: client ? 'Client exists' : 'No client'
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
