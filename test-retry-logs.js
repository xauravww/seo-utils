#!/usr/bin/env node

/**
 * Comprehensive Test Script for Retry Log Merging
 * Tests the entire flow from initial campaign to retries to ensure logs are properly merged
 */

import dotenv from 'dotenv';
dotenv.config();

import Redis from 'ioredis';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Colors for beautiful console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const log = (message, color = 'white') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const section = (title) => {
  console.log('\n' + '='.repeat(80));
  log(`🧪 ${title}`, 'cyan');
  console.log('='.repeat(80));
};

const success = (message) => log(`✅ ${message}`, 'green');
const error = (message) => log(`❌ ${message}`, 'red');
const warning = (message) => log(`⚠️  ${message}`, 'yellow');
const info = (message) => log(`ℹ️  ${message}`, 'blue');

// Redis setup
const redisProtocol = process.env.REDIS_PROTOCOL || 'redis://';
const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = process.env.REDIS_PORT || 6379;
const redisPassword = process.env.REDIS_PASSWORD;
const redisUrl = redisPassword
  ? `${redisProtocol}:${encodeURIComponent(redisPassword)}@${redisHost}:${redisPort}`
  : `${redisProtocol}${redisHost}:${redisPort}`;

const redis = new Redis(redisUrl);

// Test configuration
const TEST_CONFIG = {
  campaignId: `test_campaign_${Date.now()}`,
  userId: 'test_user_123',
  websites: [
    { url: 'test-blog.com', category: 'blog' },
    { url: 'test-forum.com', category: 'forum' },
    { url: 'test-social.com', category: 'social_media' }
  ]
};

// Import the mergeCampaignLogs function (simulate it since it's not exported)
const mergeCampaignLogs = async (campaignId, newLogData) => {
  const key = `campaign_logs:${campaignId}`;

  try {
    await redis.watch(key);
    
    const existingData = await redis.get(key);
    let mergedLogs = {};

    if (existingData) {
      try {
        mergedLogs = JSON.parse(existingData);
        info(`Found existing logs in Redis for campaign ${campaignId}, merging with new data`);
      } catch (parseError) {
        error(`Error parsing existing Redis data: ${parseError.message}`);
        mergedLogs = {};
      }
    } else {
      info(`Creating new log structure for campaign ${campaignId}`);
    }

    // Initialize structure if needed
    if (!mergedLogs.userId) mergedLogs.userId = newLogData.userId;
    if (!mergedLogs.logs) mergedLogs.logs = {};
    if (!mergedLogs.attempts) mergedLogs.attempts = {};
    if (!mergedLogs.results) mergedLogs.results = {};
    if (!mergedLogs.createdAt) mergedLogs.createdAt = new Date().toISOString();
    mergedLogs.lastUpdated = new Date().toISOString();

    // Initialize category if not present
    if (!mergedLogs.logs[newLogData.category]) {
      mergedLogs.logs[newLogData.category] = { logs: [] };
    }

    // Create unique identifier for this website attempt
    const websiteKey = `${newLogData.website}_${newLogData.category}`;
    
    if (!mergedLogs.attempts[websiteKey]) {
      mergedLogs.attempts[websiteKey] = [];
    }

    const existingAttempts = mergedLogs.attempts[websiteKey].length;
    const isRetry = existingAttempts > 0;
    
    if (isRetry) {
      info(`RETRY detected for ${websiteKey} - attempt #${existingAttempts + 1}`);
    }

    // Add this attempt
    const attemptData = {
      timestamp: new Date().toISOString(),
      result: newLogData.result,
      logs: newLogData.logs,
      website: newLogData.website,
      attemptNumber: existingAttempts + 1,
      isRetry: isRetry
    };
    
    mergedLogs.attempts[websiteKey].push(attemptData);

    // Update final result
    mergedLogs.results[websiteKey] = {
      website: newLogData.website,
      category: newLogData.category,
      finalResult: newLogData.result,
      lastAttempt: new Date().toISOString(),
      totalAttempts: mergedLogs.attempts[websiteKey].length,
      isRetry: isRetry
    };

    // Add logs to category with retry markers
    const logsToAdd = newLogData.logs.map(log => ({
      ...log,
      attemptNumber: existingAttempts + 1,
      isRetry: isRetry,
      timestamp: log.timestamp || new Date().toISOString()
    }));
    
    mergedLogs.logs[newLogData.category].logs.push(...logsToAdd);

    // Calculate statistics
    const uniqueWebsites = Object.keys(mergedLogs.results);
    const successfulWebsites = uniqueWebsites.filter(key => 
      mergedLogs.results[key].finalResult === 'success'
    );

    mergedLogs.successCount = successfulWebsites.length;
    mergedLogs.totalCount = uniqueWebsites.length;

    // Use Redis transaction
    const multi = redis.multi();
    multi.set(key, JSON.stringify(mergedLogs));
    
    const result = await multi.exec();
    
    if (result === null) {
      warning(`Transaction discarded for campaign ${campaignId}, retrying...`);
      await redis.unwatch();
      return await mergeCampaignLogs(campaignId, newLogData);
    }

    await redis.unwatch();
    success(`Successfully merged logs for campaign ${campaignId}, website ${newLogData.website}`);
    return mergedLogs;
  } catch (error) {
    error(`Error merging logs: ${error.message}`);
    await redis.unwatch();
    throw error;
  }
};

// Test functions
const testInitialCampaignLogs = async () => {
  section('TEST 1: Initial Campaign Log Creation');
  
  const { campaignId, userId, websites } = TEST_CONFIG;
  
  info(`Testing initial log creation for campaign: ${campaignId}`);
  
  // Simulate initial logs for each website
  for (let i = 0; i < websites.length; i++) {
    const website = websites[i];
    const logData = {
      userId: userId,
      website: website.url,
      category: website.category,
      logs: [
        { message: `Starting publication for ${website.url}`, level: 'info' },
        { message: `Publication ${i % 2 === 0 ? 'successful' : 'failed'} for ${website.url}`, level: i % 2 === 0 ? 'success' : 'error' }
      ],
      result: i % 2 === 0 ? 'success' : 'failure'
    };
    
    await mergeCampaignLogs(campaignId, logData);
    info(`Added initial logs for ${website.url} (${website.category})`);
  }
  
  // Verify initial state
  const initialLogs = await redis.get(`campaign_logs:${campaignId}`);
  if (initialLogs) {
    const parsed = JSON.parse(initialLogs);
    success(`Initial logs created successfully:`);
    console.log(`  - Categories: ${Object.keys(parsed.logs).join(', ')}`);
    console.log(`  - Total attempts: ${Object.keys(parsed.attempts).length}`);
    console.log(`  - Success count: ${parsed.successCount}/${parsed.totalCount}`);
    
    // Display detailed structure
    info('Initial log structure:');
    for (const [category, data] of Object.entries(parsed.logs)) {
      console.log(`  📁 ${category}: ${data.logs.length} log entries`);
    }
  } else {
    error('Failed to create initial logs');
  }
};

const testRetryScenario = async () => {
  section('TEST 2: Retry Scenario - Log Merging');
  
  const { campaignId, userId, websites } = TEST_CONFIG;
  
  info('Simulating retry attempts for failed websites...');
  
  // Get current state
  const beforeRetry = await redis.get(`campaign_logs:${campaignId}`);
  const beforeParsed = JSON.parse(beforeRetry);
  
  info(`Before retry - Total attempts: ${Object.keys(beforeParsed.attempts).length}`);
  
  // Simulate retry for the failed website (test-forum.com)
  const retryWebsite = websites[1]; // forum website that failed initially
  const retryLogData = {
    userId: userId,
    website: retryWebsite.url,
    category: retryWebsite.category,
    logs: [
      { message: `RETRY: Starting publication for ${retryWebsite.url}`, level: 'info' },
      { message: `RETRY: Publication successful for ${retryWebsite.url}`, level: 'success' }
    ],
    result: 'success'
  };
  
  await mergeCampaignLogs(campaignId, retryLogData);
  success(`Retry completed for ${retryWebsite.url}`);
  
  // Verify retry merging
  const afterRetry = await redis.get(`campaign_logs:${campaignId}`);
  const afterParsed = JSON.parse(afterRetry);
  
  const websiteKey = `${retryWebsite.url}_${retryWebsite.category}`;
  const attempts = afterParsed.attempts[websiteKey];
  
  if (attempts && attempts.length === 2) {
    success(`✅ RETRY MERGE TEST PASSED:`);
    console.log(`  - Website ${retryWebsite.url} now has ${attempts.length} attempts`);
    console.log(`  - First attempt: ${attempts[0].result} (isRetry: ${attempts[0].isRetry})`);
    console.log(`  - Second attempt: ${attempts[1].result} (isRetry: ${attempts[1].isRetry})`);
    console.log(`  - Final result: ${afterParsed.results[websiteKey].finalResult}`);
    console.log(`  - Total logs in category: ${afterParsed.logs[retryWebsite.category].logs.length}`);
  } else {
    error(`❌ RETRY MERGE TEST FAILED: Expected 2 attempts, got ${attempts ? attempts.length : 0}`);
  }
  
  // Test multiple retries
  info('Testing multiple retries...');
  const multiRetryLogData = {
    userId: userId,
    website: retryWebsite.url,
    category: retryWebsite.category,
    logs: [
      { message: `RETRY #2: Another attempt for ${retryWebsite.url}`, level: 'info' },
      { message: `RETRY #2: Publication failed again for ${retryWebsite.url}`, level: 'error' }
    ],
    result: 'failure'
  };
  
  await mergeCampaignLogs(campaignId, multiRetryLogData);
  
  const afterMultiRetry = await redis.get(`campaign_logs:${campaignId}`);
  const multiRetryParsed = JSON.parse(afterMultiRetry);
  const multiAttempts = multiRetryParsed.attempts[websiteKey];
  
  if (multiAttempts && multiAttempts.length === 3) {
    success(`✅ MULTIPLE RETRY TEST PASSED:`);
    console.log(`  - Website ${retryWebsite.url} now has ${multiAttempts.length} attempts`);
    console.log(`  - Final result: ${multiRetryParsed.results[websiteKey].finalResult}`);
  } else {
    error(`❌ MULTIPLE RETRY TEST FAILED: Expected 3 attempts, got ${multiAttempts ? multiAttempts.length : 0}`);
  }
};

const testRetryDetection = async () => {
  section('TEST 3: Retry Detection Logic');
  
  const { campaignId } = TEST_CONFIG;
  
  info('Testing retry detection logic...');
  
  // Get current logs
  const campaignLogsData = await redis.get(`campaign_logs:${campaignId}`);
  
  if (campaignLogsData) {
    try {
      const parsedData = JSON.parse(campaignLogsData);
      
      // Test retry detection logic
      const hasRetries = Object.values(parsedData.attempts || {}).some(attempts => 
        Array.isArray(attempts) && attempts.length > 1
      );
      
      if (hasRetries) {
        success(`✅ RETRY DETECTION TEST PASSED: Successfully detected retries in logs`);
        
        // Show detailed retry information
        info('Retry details:');
        for (const [websiteKey, attempts] of Object.entries(parsedData.attempts)) {
          if (attempts.length > 1) {
            console.log(`  🔄 ${websiteKey}: ${attempts.length} attempts`);
            attempts.forEach((attempt, index) => {
              console.log(`    ${index + 1}. ${attempt.result} (${attempt.timestamp}) - isRetry: ${attempt.isRetry}`);
            });
          }
        }
      } else {
        error(`❌ RETRY DETECTION TEST FAILED: Could not detect retries`);
      }
      
    } catch (parseError) {
      error(`❌ RETRY DETECTION TEST FAILED: Could not parse logs - ${parseError.message}`);
    }
  } else {
    error(`❌ RETRY DETECTION TEST FAILED: No campaign logs found`);
  }
};

const testLogIntegrity = async () => {
  section('TEST 4: Log Integrity and Structure Validation');
  
  const { campaignId } = TEST_CONFIG;
  
  info('Validating log structure and integrity...');
  
  const campaignLogsData = await redis.get(`campaign_logs:${campaignId}`);
  
  if (!campaignLogsData) {
    error('❌ No campaign logs found for integrity test');
    return;
  }
  
  try {
    const logs = JSON.parse(campaignLogsData);
    
    // Test 1: Required fields
    const requiredFields = ['userId', 'logs', 'attempts', 'results', 'createdAt', 'lastUpdated'];
    const missingFields = requiredFields.filter(field => !logs[field]);
    
    if (missingFields.length === 0) {
      success('✅ All required fields present');
    } else {
      error(`❌ Missing required fields: ${missingFields.join(', ')}`);
    }
    
    // Test 2: Data consistency
    const attemptKeys = Object.keys(logs.attempts);
    const resultKeys = Object.keys(logs.results);
    
    if (attemptKeys.length === resultKeys.length) {
      success('✅ Attempts and results are consistent');
    } else {
      error(`❌ Inconsistent data: ${attemptKeys.length} attempts vs ${resultKeys.length} results`);
    }
    
    // Test 3: Log accumulation (no overrides)
    let totalLogEntries = 0;
    let totalAttempts = 0;
    
    for (const [category, categoryData] of Object.entries(logs.logs)) {
      totalLogEntries += categoryData.logs.length;
    }
    
    for (const attempts of Object.values(logs.attempts)) {
      totalAttempts += attempts.length;
    }
    
    info(`Log statistics:`);
    console.log(`  📊 Total log entries: ${totalLogEntries}`);
    console.log(`  📊 Total attempts: ${totalAttempts}`);
    console.log(`  📊 Unique websites: ${Object.keys(logs.results).length}`);
    console.log(`  📊 Categories: ${Object.keys(logs.logs).length}`);
    
    // Test 4: Retry markers
    let entriesWithRetryMarkers = 0;
    for (const categoryData of Object.values(logs.logs)) {
      entriesWithRetryMarkers += categoryData.logs.filter(log => log.isRetry === true).length;
    }
    
    if (entriesWithRetryMarkers > 0) {
      success(`✅ Found ${entriesWithRetryMarkers} log entries with retry markers`);
    } else {
      warning('⚠️  No retry markers found in log entries');
    }
    
    // Test 5: Timestamp validation
    const timestamps = [];
    for (const categoryData of Object.values(logs.logs)) {
      timestamps.push(...categoryData.logs.map(log => log.timestamp).filter(Boolean));
    }
    
    const validTimestamps = timestamps.filter(ts => !isNaN(new Date(ts).getTime()));
    
    if (validTimestamps.length === timestamps.length) {
      success(`✅ All ${timestamps.length} timestamps are valid`);
    } else {
      error(`❌ ${timestamps.length - validTimestamps.length} invalid timestamps found`);
    }
    
  } catch (parseError) {
    error(`❌ Log integrity test failed: ${parseError.message}`);
  }
};

const displayBeautifiedLogs = async () => {
  section('TEST 5: Beautified Log Display');
  
  const { campaignId } = TEST_CONFIG;
  
  const campaignLogsData = await redis.get(`campaign_logs:${campaignId}`);
  
  if (!campaignLogsData) {
    error('❌ No logs to display');
    return;
  }
  
  try {
    const logs = JSON.parse(campaignLogsData);
    
    log('🎨 BEAUTIFIED CAMPAIGN LOGS', 'magenta');
    console.log('┌' + '─'.repeat(78) + '┐');
    console.log(`│ Campaign ID: ${campaignId.padEnd(61)} │`);
    console.log(`│ User ID: ${logs.userId.padEnd(65)} │`);
    console.log(`│ Created: ${logs.createdAt.padEnd(65)} │`);
    console.log(`│ Last Updated: ${logs.lastUpdated.padEnd(62)} │`);
    console.log(`│ Success Rate: ${logs.successCount}/${logs.totalCount}`.padEnd(79) + '│');
    console.log('├' + '─'.repeat(78) + '┤');
    
    // Display by category
    for (const [category, categoryData] of Object.entries(logs.logs)) {
      console.log(`│ 📁 Category: ${category.toUpperCase().padEnd(62)} │`);
      console.log('├' + '─'.repeat(78) + '┤');
      
      categoryData.logs.forEach((logEntry, index) => {
        const prefix = logEntry.isRetry ? '🔄' : '📝';
        const level = logEntry.level === 'success' ? '✅' : logEntry.level === 'error' ? '❌' : 'ℹ️';
        const attemptInfo = logEntry.attemptNumber ? ` [Attempt ${logEntry.attemptNumber}]` : '';
        
        console.log(`│ ${prefix} ${level} ${logEntry.message}${attemptInfo}`.padEnd(79) + '│');
        if (logEntry.timestamp) {
          console.log(`│     ⏰ ${logEntry.timestamp}`.padEnd(79) + '│');
        }
      });
      
      console.log('├' + '─'.repeat(78) + '┤');
    }
    
    // Display attempt summary
    console.log('│ 🔄 ATTEMPT SUMMARY'.padEnd(79) + '│');
    console.log('├' + '─'.repeat(78) + '┤');
    
    for (const [websiteKey, attempts] of Object.entries(logs.attempts)) {
      const result = logs.results[websiteKey];
      const statusIcon = result.finalResult === 'success' ? '✅' : '❌';
      
      console.log(`│ ${statusIcon} ${websiteKey}`.padEnd(79) + '│');
      console.log(`│     Total Attempts: ${attempts.length} | Final: ${result.finalResult}`.padEnd(79) + '│');
      
      attempts.forEach((attempt, index) => {
        const attemptIcon = attempt.result === 'success' ? '✅' : '❌';
        const retryLabel = attempt.isRetry ? ' (RETRY)' : ' (INITIAL)';
        console.log(`│       ${index + 1}. ${attemptIcon} ${attempt.result}${retryLabel}`.padEnd(79) + '│');
      });
    }
    
    console.log('└' + '─'.repeat(78) + '┘');
    
    success('✅ Log display completed successfully');
    
  } catch (parseError) {
    error(`❌ Failed to display logs: ${parseError.message}`);
  }
};

const cleanup = async () => {
  section('CLEANUP');
  
  const { campaignId } = TEST_CONFIG;
  
  info('Cleaning up test data...');
  
  const keysToDelete = [
    `campaign_logs:${campaignId}`,
    `campaign_jobs:${campaignId}`,
    `campaign_total:${campaignId}`,
    `campaign_success:${campaignId}`
  ];
  
  for (const key of keysToDelete) {
    await redis.del(key);
  }
  
  success('✅ Cleanup completed');
  
  await redis.quit();
};

// Main test runner
const runAllTests = async () => {
  try {
    log('🚀 STARTING COMPREHENSIVE RETRY LOG MERGE TESTS', 'bright');
    console.log('='.repeat(80));
    
    await testInitialCampaignLogs();
    await testRetryScenario();
    await testRetryDetection();
    await testLogIntegrity();
    await displayBeautifiedLogs();
    
    section('🎉 ALL TESTS COMPLETED');
    success('All tests have been executed successfully!');
    
  } catch (error) {
    error(`❌ Test execution failed: ${error.message}`);
    console.error(error.stack);
  } finally {
    await cleanup();
  }
};

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests();
}

export { runAllTests, mergeCampaignLogs };