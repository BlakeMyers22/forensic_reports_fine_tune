const { MongoClient } = require('mongodb');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    const client = new MongoClient(process.env.MONGODB_URI);

    try {
        await client.connect();
        const db = client.db('forensic-reports');
        const ratingsCollection = db.collection('ratings');
        const highQualityCollection = db.collection('high-quality-examples');
        
        const ratingData = JSON.parse(event.body);
        
        // Format the data for fine-tuning
        const trainingExample = {
            ...ratingData,
            rating: parseInt(ratingData.rating),
            timestamp: new Date(),
            trainingFormat: {
                messages: [
                    {
                        role: "system",
                        content: "You are an expert forensic engineer generating professional report sections."
                    },
                    {
                        role: "user",
                        content: ratingData.originalPrompt
                    },
                    {
                        role: "assistant",
                        content: ratingData.generatedContent
                    }
                ]
            }
        };

        // Store all ratings
        await ratingsCollection.insertOne(trainingExample);

        // Store high-quality examples separately (ratings >= 6)
        if (ratingData.rating >= 6) {
            await highQualityCollection.insertOne(trainingExample);
            
            // Check if we have enough new high-quality examples to trigger fine-tuning
            const highQualityCount = await highQualityCollection.countDocuments({
                timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
            });

            // If we have 10+ new high-quality examples, trigger fine-tuning
            if (highQualityCount >= 10) {
                await fetch('/.netlify/functions/fine-tune-model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trigger: 'new_high_quality_examples' })
                });
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                message: 'Rating stored successfully',
                triggered_fine_tuning: highQualityCount >= 10
            })
        };

    } catch (error) {
        console.error('Error storing rating:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to store rating',
                details: error.message 
            })
        };
    } finally {
        await client.close();
    }
};
