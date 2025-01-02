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

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    let client;
    try {
        client = new MongoClient(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });

        console.log('Attempting to connect to MongoDB...');
        await client.connect();
        console.log('MongoDB connected successfully');

        const db = client.db('forensic-reports');
        const config = await db.collection('config').findOne({ key: 'latest_model' });
        console.log('Retrieved model config:', config);

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
        console.error('Error checking model status:', {
            message: error.message,
            stack: error.stack,
            mongoState: client?.topology?.state
        });

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to check model status',
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
