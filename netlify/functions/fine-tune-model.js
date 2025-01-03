const { MongoClient } = require('mongodb');
const OpenAI = require('openai');
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

exports.handler = async function(event, context) {
    const client = new MongoClient(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000
    });

    try {
        console.log('Attempting to connect to MongoDB...');
        await client.connect();
        console.log('MongoDB connected successfully');
        
        const db = client.db('forensic-reports');
        
        // Get high-quality examples
        const highQualityExamples = await db.collection('high-quality-examples')
            .find({ 
                timestamp: { 
                    $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                } 
            })
            .toArray();

        console.log('Found high-quality examples:', highQualityExamples.length);

        if (highQualityExamples.length < 10) {
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    message: 'Not enough new high-quality examples for fine-tuning',
                    count: highQualityExamples.length
                })
            };
        }

        // Format data for fine-tuning
        const trainingData = highQualityExamples.map(example => example.trainingFormat);
        
        // Create fine-tuning job
        console.log('Creating fine-tuning job...');
        const fineTuningJob = await openai.fineTuning.jobs.create({
            model: "gpt-4-0125-preview",
            training_data: trainingData,
            hyperparameters: {
                n_epochs: 3
            }
        });

        console.log('Fine-tuning job created:', fineTuningJob.id);

        // Store the new model ID
        await db.collection('config').updateOne(
            { key: 'latest_model' },
            { 
                $set: { 
                    modelId: fineTuningJob.fine_tuned_model,
                    timestamp: new Date(),
                    trainingExamples: highQualityExamples.length
                }
            },
            { upsert: true }
        );

        // Archive used examples
        const bulkOps = highQualityExamples.map(example => ({
            deleteOne: {
                filter: { _id: example._id }
            }
        }));
        
        await db.collection('high-quality-examples').bulkWrite(bulkOps);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Fine-tuning job created successfully',
                jobId: fineTuningJob.id,
                examplesUsed: highQualityExamples.length
            })
        };

    } catch (error) {
        console.error('Detailed error in fine-tuning:', {
            message: error.message,
            stack: error.stack,
            mongoState: client?.topology?.state
        });
        
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Failed to create fine-tuning job',
                details: error.message,
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
