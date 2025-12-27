import { logger } from './utils/logger';
import { monitorQueue } from './queues/monitotQueue';


const areaEnv = process.env.AREA || '';
const areaList = areaEnv.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const [id, name] = pair.split(':').map(x => x.trim());
    return { id, name: name };
});


async function scheduleOnce() {
    const apiUrl = process.env.API_URL || '';
    for (let i = 0; i < areaList.length; i++) {
        const area = areaList[i];
        await monitorQueue.add('checkApi', { apiUrl, areaKey: area.id, index: i, areaName: area.name }, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000 },
            removeOnComplete: true,
            removeOnFail: false
        });
        logger.info(`Enqueued job for area ${area.name} with id: ${area.id}`);
    }
}

const intervalSec = Number(process.env.CHECK_INTERVAL || 3600);
setInterval(() => {
    scheduleOnce();
}, intervalSec * 1000);