const { MongoClient } = require('mongodb');

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    const client = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    try {
        await client.connect();
        const db = client.db('forensic-reports');
        const config = await db.collection('config').findOne({ key: 'latest_model' });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                currentModel: config?.modelId || 'gpt-4-0125-preview',
                lastUpdated: config?.timestamp || null
            })
        };
    } catch (error) {
        console.error('Error checking model status:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to check model status',
                details: error.message
            })
        };
    } finally {
        await client.close();
    }
};
