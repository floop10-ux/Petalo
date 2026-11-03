const { 
  isValidFileId, isValidS3Url, s3UrlToKey, SITE_URL 
} = require('./config');

const { 
  getBouquetsFromDb, getShopFromDb, updateBouquetField, 
  saveShopSettings 
} = require('./db-actions');

async function sendBouquetPhotoAsFile(bot, chatId, b) {
  if (!b.photos || b.photos.length === 0) {
    return bot.sendMessage(chatId, '❌ У букета нет фото.');
  }
  
  const firstPhoto = b.photos[0];
  const num = b.shopNumber || b.id;
  const rawName = String(b.name || 'buket');
  
  const safeName = rawName.replace(/[^\wа-яА-ЯёЁ\- ]/g, '')
    .trim().slice(0, 20) || 'buket';
  
  const fileName = `buket_${num}_${safeName}.jpg`;
  const caption = `📸 Оригинал — №${num} «${b.name}»`;

  try {
    let docRef = null;
    
    if (typeof firstPhoto === 'object' && firstPhoto.s3) {
      const key = s3UrlToKey(firstPhoto.s3);
      if (key) {
        docRef = SITE_URL + '/photo/s3/' + key;
      } else if (isValidS3Url(firstPhoto.s3)) {
        docRef = firstPhoto.s3;
      }
    }
    
    if (!docRef && typeof firstPhoto === 'object' 
        && firstPhoto.tg && isValidFileId(firstPhoto.tg)) {
      docRef = firstPhoto.tg;
    }
    
    if (!docRef && typeof firstPhoto === 'string' 
        && isValidFileId(firstPhoto)) {
      docRef = firstPhoto;
    }
    
    if (!docRef && typeof firstPhoto === 'string' 
        && firstPhoto.startsWith('http')) {
      docRef = firstPhoto;
    }

    if (!docRef) {
      return bot.sendMessage(chatId, '❌ Фото недоступно.');
    }

    await bot.sendDocument(chatId, docRef, { caption }, {
      filename: fileName,
      contentType: 'image/jpeg'
    });
  } catch (e) {
    console.error('Ошибка отправки фото:', e?.message || e);
    return bot.sendMessage(chatId, '❌ Не удалось отправить фото.');
  }
}

async function migratePhotosToS3(shopId, bot, s3ctx) {
  const result = { migrated: 0, skipped: 0, failed: 0 };
  
  const { 
    S3_ENABLED, YC_BUCKET, s3,
    S3_BACKUP_ENABLED, BC_BUCKET, BC_ENDPOINT, s3backup
  } = s3ctx;
  
  if (!S3_ENABLED) {
    throw new Error('Основной S3 не настроен');
  }
  
  const { PutObjectCommand } = require('@aws-sdk/client-s3');

  async function downloadTelegramFile(fileId) {
    const fileLink = await bot.getFileLink(fileId);
    
    const controller = new AbortController();
    const timeout = setTimeout(function() { 
      controller.abort(); 
    }, 15000);
    
    try {
      const res = await fetch(fileLink, { signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  async function uploadToS3(buffer, key) {
    const cmd = new PutObjectCommand({
      Bucket: YC_BUCKET, 
      Key: key, 
      Body: buffer, 
      ContentType: 'image/jpeg'
    });
    await s3.send(cmd);
    
    const primaryUrl = `https://${YC_BUCKET}.storage.yandexcloud.net/${key}`;
    let backupUrl = null;

    if (S3_BACKUP_ENABLED) {
      try {
        const cmd2 = new PutObjectCommand({
          Bucket: BC_BUCKET, 
          Key: key, 
          Body: buffer, 
          ContentType: 'image/jpeg'
        });
        await s3backup.send(cmd2);
        backupUrl = BC_ENDPOINT + '/' + BC_BUCKET + '/' + key;
      } catch (err) {
        console.error('⚠️ Backup S3 error:', err.message);
      }
    }

    return { s3: primaryUrl, s3b: backupUrl };
  }

  const bouquets = await getBouquetsFromDb(shopId, true);
  
  for (const b of bouquets) {
    if (!b.photos || b.photos.length === 0) continue;
    let changed = false;
    const newPhotos = [];
    
    for (const ref of b.photos) {
      if (!ref) continue;
      
      if (typeof ref === 'object' && ref.s3) {
        newPhotos.push(ref); result.skipped++; continue;
      }
      
      if (typeof ref === 'string' 
          && (ref.startsWith('http') || ref.startsWith('https'))) {
        newPhotos.push(ref); result.skipped++; continue;
      }
      
      if (!isValidFileId(ref)) {
        newPhotos.push(ref); result.skipped++; continue;
      }
      
      try {
        const buf = await downloadTelegramFile(ref);
        const rand = Math.random().toString(36).slice(2, 8);
        const key = `${shopId}/${Date.now()}_${b.id}_${rand}.jpg`;
        
        const uploadRes = await uploadToS3(buf, key);
        
        let photoObj = { s3: uploadRes.s3, tg: ref };
        if (uploadRes.s3b) {
          photoObj.s3b = uploadRes.s3b;
        }
        
        newPhotos.push(photoObj);
        result.migrated++; changed = true;
        
        await new Promise(function(r) { setTimeout(r, 100); });
        
      } catch (e) {
        console.error('⚠️ Миграция не удалась (id=' + b.id + '):', 
          e?.message || e);
        newPhotos.push(ref); result.failed++;
      }
    }
    
    if (changed) {
      await updateBouquetField(b.id, 'photos', JSON.stringify(newPhotos));
    }
  }

  const shop = await getShopFromDb(shopId);
  if (shop) {
    const settings = Object.assign({}, shop.settings);
    let settingsChanged = false;
    
    for (const field of ['logo', 'background', 'cover']) {
      const ref = settings[field];
      if (!ref || typeof ref === 'object') { 
        result.skipped++; continue; 
      }
      if (typeof ref === 'string' && ref.startsWith('http')) { 
        result.skipped++; continue; 
      }
      if (!isValidFileId(ref)) continue;
      
      try {
        const buf = await downloadTelegramFile(ref);
        const rand = Math.random().toString(36).slice(2, 8);
        const key = `${shopId}/_${field}_${Date.now()}_${rand}.jpg`;
        
        const uploadRes = await uploadToS3(buf, key);
        
        let photoObj = { s3: uploadRes.s3, tg: ref };
        if (uploadRes.s3b) {
          photoObj.s3b = uploadRes.s3b;
        }
        
        settings[field] = photoObj;
        settingsChanged = true; result.migrated++;
      } catch (e) {
        console.error('⚠️ Миграция ' + field + ':', e?.message || e);
        result.failed++;
      }
    }
    
    if (settingsChanged) {
      await saveShopSettings(shopId, settings);
    }
  }

  return result;
}

module.exports = { sendBouquetPhotoAsFile, migratePhotosToS3 };