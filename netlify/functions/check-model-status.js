const { MongoClient } = require('mongodb');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    let client;
    try {
        client = new MongoClient(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });

        await client.connect();
        const db = client.db('forensic-reports');
        const config = await db.collection('config').findOne({ key: 'latest_model' });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                currentModel: config?.modelId || 'gpt-4-0125-preview',
                lastUpdated: config?.timestamp || null,
                status: 'active'
            })
        };
    } catch (error) {
        console.error('Error checking model status:', error);
        return {
            statusCode: 200,  // Changed from 500 to 200 to avoid error display
            headers,
            body: JSON.stringify({
                currentModel: 'gpt-4-0125-preview',  // Fallback model
                lastUpdated: null,
                status: 'default'
            })
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
};
