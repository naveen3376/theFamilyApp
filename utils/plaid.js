const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");
require("dotenv").config();

// Determine Plaid environment and secret based on PLAID_ENV
const getPlaidConfig = () => {
    const environment = process.env.PLAID_ENV || 'sandbox';
    let plaidEnv, plaidSecret;

    switch (environment.toLowerCase()) {
        case 'production':
            plaidEnv = PlaidEnvironments.production;
            plaidSecret = process.env.PLAID_SECRET;
            console.log('Using Plaid Production Environment');
            break;
        case 'development':
            plaidEnv = PlaidEnvironments.development;
            plaidSecret = process.env.PLAID_SECRET_SANDBOX;
            console.log('Using Plaid Development Environment');
            break;
        case 'sandbox':
            plaidEnv = PlaidEnvironments.sandbox;
            plaidSecret = process.env.PLAID_SECRET_SANDBOX;
            console.log('Using Plaid Sandbox Environment');
            break;
        default:
            console.warn('Invalid PLAID_ENV, falling back to sandbox');
            plaidEnv = PlaidEnvironments.sandbox;
            plaidSecret = process.env.PLAID_SECRET_SANDBOX;
    }

    if (!plaidSecret) {
        throw new Error(`Missing Plaid secret for ${environment} environment`);
    }

    return {
        basePath: plaidEnv,
        baseOptions: {
            headers: {
                'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
                'PLAID-SECRET': plaidSecret,
            },
        },
    };
};

// Initialize Plaid client with environment-specific configuration
const config = new Configuration(getPlaidConfig());
const plaidClient = new PlaidApi(config);

const AWS = require("aws-sdk");

if (process.env.NODE_ENV === "production") {
    // Use IAM role on EC2
    AWS.config.update({ region: process.env.AWS_REGION || "us-east-2" });
} else {
    // Use credentials from .env
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || "us-east-2",
    });
}

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const getTransactions = async (access_token, plaidClient) => {
    if (!access_token) {
        throw new Error("No access token found. Link a bank account first.");
    }

    try {
        console.log("Fetching transactions...");
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 3); // Fetch transactions from the last 3 months
        const endDate = new Date();

        const response = await plaidClient.transactionsGet({
            access_token,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
        });

        const transactions = response.data.transactions;
        // Classify transactions
        const income = transactions.filter(txn => txn.amount > 0);
        const expenses = transactions.filter(txn => txn.amount < 0);
        console.log("classified transactions", income, expenses);
        return {
            success: true,
            income,
            expenses,
            totalIncome: income.reduce((sum, txn) => sum + txn.amount, 0),
            totalExpenses: expenses.reduce((sum, txn) => sum + Math.abs(txn.amount), 0),
        };

    } catch (error) {
        console.error("Error fetching transactions:", error.response ? error.response.data : error);
        throw error;
    }
}

async function getTransactionsByMonth(accessToken, plaidClient, startDate, endDate) {
    try {
        const response = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
        });
        return response.data.transactions;
    } catch (error) {
        console.error('Error fetching current month transactions:', error);
        throw error;
    }
}

async function getPreviousMonthTransactions(accessToken, plaidClient, startDate, endDate) {
    try {
        const response = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
        });
        return response.data.transactions;
    } catch (error) {
        console.error('Error fetching previous month transactions:', error);
        throw error;
    }
}

const processMonthlyData = (transactions, startDate, endDate) => {
    const dailyTotals = {};
    let cumulative = 0;
    const dates = [];
    const cumulativeAmounts = [];
    // Initialize all dates with 0

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        dailyTotals[dateStr] = 0;
        dates.push(dateStr);
    }
    // Sum transactions by date
    transactions.forEach(txn => {
        const dateStr = txn.date.split('T')[0];
        if (dailyTotals[dateStr] !== undefined) {
            dailyTotals[dateStr] += txn.amount;
        }
    });
    
    // Calculate cumulative amounts
    dates.forEach(date => {
        cumulative += dailyTotals[date];
        cumulativeAmounts.push(cumulative);
    });
    return { dates, cumulative: cumulativeAmounts };
};

const getTransactionsByStartDate = async (access_token, plaidClient, startDate,endDate) => {
    try {
        const response = await plaidClient.transactionsGet({
            access_token,
            start_date: startDate,
            end_date: endDate,
        });
        return response.data.transactions;
    } catch (error) {
        console.error("Error fetching transactions:", error.response ? error.response.data : error);
        throw error;
    }
}

const getIncomeExpenseRules = async (familyid) => {
    const incomeParams = {
        TableName: 'Transactions',
        Key: {
            familyid: familyid,
            doctype: 'income'
        }
    };
    const expenseParams = {
        TableName: 'Transactions',
        Key: {
            familyid: familyid,
            doctype: 'expenses'
        }
    };

    const [incomeRules, expenseRules] = await Promise.all([
        dynamoDB.get(incomeParams).promise(),
        dynamoDB.get(expenseParams).promise()
    ]);
    return {
        incomeRules: incomeRules.Item,
        expenseRules: expenseRules.Item
    };
}



const processTransactions = async (transactions, rules) => {
    if (!rules) return transactions;
    
    //Exclude transactions based on rules
    transactions = transactions.filter(txn => {
        const txnRules = txn.amount < 0 ? rules.expenseRules : rules.incomeRules;
        if (!txnRules) return true;
        
        return !(
            txnRules.excludedIds?.includes(txn.transaction_id) ||
            txnRules.excludedMerchants?.includes(txn.merchant_name)
        );
    });
    
    //Categorize transactions
    transactions = transactions.map(txn => {
        const txnRules = txn.amount < 0 ? rules.expenseRules : rules.incomeRules; 
        if (!txnRules) return txn;

        const customCategory = 
            txnRules.idCategory?.[txn.transaction_id] || 
            txnRules.merchantCategory?.[txn.merchant_name] ||
            'Uncategorized';

        return {
            ...txn,
            customCategory
        };
    });

    return transactions;
}

const syncTransactions = async (req, res) => {
  try {
      const familyid = req.session.userinfo.families[0].familyid;
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      // Fetch the last sync date from DynamoDB
      const budgetParams = {
          TableName: "Budget",
          Key: { familyid: familyid, month: currentMonth },
      };

      const budgetResult = await dynamoDB.get(budgetParams).promise();
      const budgetData = budgetResult.Item || { income: 0, expenses: 0, lastSync: null };

      const lastSyncDate = req.session.CategoryExclusionUpdated
        ? new Date(0)
        : (budgetData.lastSync ? new Date(budgetData.lastSync) : new Date(0));

      const transactions = await getTransactionsByStartDate(req.session.userinfo.families[0].plaidAccessToken, plaidClient, lastSyncDate.toISOString().split('T')[0], endOfMonth.split('T')[0]);
      if (!transactions || transactions.length === 0) {
        console.log("Nothing to sync");
        return true;
      }
      const rules = await getIncomeExpenseRules(req.session.userinfo.families[0].familyid);
      const processedTransactions = await processTransactions(transactions, rules);

      // Group transactions by month
      const transactionsByMonth = {};
      for (const transaction of processedTransactions) {
          const month = transaction.date.substring(0, 7); // Format: YYYY-MM
          if (!transactionsByMonth[month]) {
              transactionsByMonth[month] = [];
          }
          transactionsByMonth[month].push(transaction);
      }

      // Calculate and update income and expenses for each month
      for (const [month, monthTransactions] of Object.entries(transactionsByMonth)) {
          let income = 0;
          let expenses = 0;

          for (const transaction of monthTransactions) {
              if (transaction.amount > 0) {
                  expenses += transaction.amount;
              } else {
                  income += Math.abs(transaction.amount);
              }
          }

          // Check if a record already exists for this month
          const monthBudget = {
              income: 0,
              expenses: 0,
          };
          if (!req.session.CategoryExclusionUpdated && budgetData.month === month) {
            monthBudget.income = budgetData.income;
            monthBudget.expenses = budgetData.expenses;
          }

          // Update DynamoDB with new totals and sync date
          const updateParams = {
              TableName: "Budget",
              Key: { familyid: familyid, month: month },
              UpdateExpression:
                  "set income = :income, expenses = :expenses, lastSync = :lastSync",
              ExpressionAttributeValues: {
                  ":income": monthBudget.income + income,
                  ":expenses": monthBudget.expenses + expenses,
                  ":lastSync": now.toISOString(),
              },
              ReturnValues: "UPDATED_NEW",
          };

          await dynamoDB.update(updateParams).promise();
      }
      req.session.CategoryExclusionUpdated = false;
      return true;
} catch (error) {
    console.error("Error syncing transactions:", error);
    throw error;
    }
}

const getMonthlyOverview = async (familyid, month) => {
  const budgetParams = {
    TableName: "Budget",
    Key: { familyid: familyid, month: month },
  };

  const budgetResult = await dynamoDB.get(budgetParams).promise();
  const budgetData = budgetResult.Item || { income: 0, expenses: 0, lastSync: null };
  return budgetData;
}

const updateExpenseCategory = async (familyid, transactionId, merchant, applyToAll, operation, category, exclude, type) => {
    try {
        const docType = type === 'INCOME' ? 'income' : 'expenses';
        
        // First, try to get the existing item
        const getParams = {
            TableName: 'Transactions',
            Key: {
                familyid: familyid,
                doctype: docType
            }
        };

        const existingItem = await dynamoDB.get(getParams).promise();

        if (!existingItem.Item) {
            // If item doesn't exist, create new item with initial values
            const newItem = {
                familyid: familyid,
                doctype: docType,
                excludedIds: [],
                excludedMerchants: [],
                idCategory: {},
                merchantCategory: {}
            };

            // Add the new category/exclusion
            if (exclude) {
                if (transactionId) newItem.excludedIds = [transactionId];
                if (merchant && applyToAll) newItem.excludedMerchants = [merchant];
            } else {
                if (transactionId) newItem.idCategory[transactionId] = category;
                if (merchant && applyToAll) newItem.merchantCategory[merchant] = category;
            }

            const putParams = {
                TableName: 'Transactions',
                Item: newItem
            };

            await dynamoDB.put(putParams).promise();
        } else {
            // If item exists, proceed with update as before
            let updateExpression = 'SET';
            const expressionAttributeValues = {};
            const expressionAttributeNames = {};

            if (exclude) {
                if (transactionId) {
                    updateExpression += ' #excludedIds = list_append(if_not_exists(#excludedIds, :empty_list), :transactionId)';
                    expressionAttributeValues[':transactionId'] = [transactionId];
                    expressionAttributeNames['#excludedIds'] = 'excludedIds';
                }
                
                if (merchant && applyToAll) {
                    updateExpression += ' #excludedMerchants = list_append(if_not_exists(#excludedMerchants, :empty_list), :merchant)';
                    expressionAttributeValues[':merchant'] = [merchant];
                    expressionAttributeNames['#excludedMerchants'] = 'excludedMerchants';
                }
                expressionAttributeValues[':empty_list'] = [];
            } else {
                if (transactionId) {
                    updateExpression += ' #idCategory.#tid = :category';
                    expressionAttributeValues[':category'] = category;
                    expressionAttributeNames['#idCategory'] = 'idCategory';
                    expressionAttributeNames['#tid'] = transactionId;
                }
                
                if (merchant && applyToAll) {
                    updateExpression += ' #merchantCategory.#mer = :category';
                    expressionAttributeValues[':category'] = category;
                    expressionAttributeNames['#merchantCategory'] = 'merchantCategory';
                    expressionAttributeNames['#mer'] = merchant;
                }
            }

            const updateParams = {
                TableName: 'Transactions',
                Key: {
                    familyid: familyid,
                    doctype: docType
                },
                UpdateExpression: updateExpression,
                ExpressionAttributeValues: expressionAttributeValues,
                ExpressionAttributeNames: expressionAttributeNames
            };

            await dynamoDB.update(updateParams).promise();
        }
        return true;
    } catch (error) {
        console.error('Error updating expense category:', error);
        throw error;
    }
};
const getLast12MonthsSavings = async (familyid) => {
    const months = [];
    const now = new Date();
    
    // Generate array of last 12 months
    for (let i = 0; i < 12; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        months.push({
            month: monthStr,
            monthYear: date.toLocaleString('default', { month: 'long', year: 'numeric' })
        });
    }

    // Fetch data for all months
    const promises = months.map(async ({ month, monthYear }) => {
        const params = {
            TableName: "Budget",
            Key: { familyid: familyid, month: month }
        };
        
        try {
            const result = await dynamoDB.get(params).promise();
            return {
                monthYear,
                income: result.Item?.income || 0,
                expenses: result.Item?.expenses || 0
            };
        } catch (error) {
            console.error(`Error fetching data for month ${month}:`, error);
            return {
                monthYear,
                income: 0,
                expenses: 0
            };
        }
    });

    return Promise.all(promises);
};

async function getAggregatedChartData(year, month, type, familyid, accessToken) {
    // Calculate date range to get 3 months of data in one call
    const endDate = new Date(year, month, 0); // End of current month
    const startDate = new Date(year, month - 3, 1); // Start of 2 months ago

    // Get all transactions in one call
    const transactions = await getTransactionsByMonth(
        accessToken,
        plaidClient,
        startDate,
        endDate
    );

    // Get and apply rules
    const rules = await getIncomeExpenseRules(familyid);
    const processedTransactions = await processTransactions(transactions, rules);

    // Group transactions by month and then by category/merchant
    const currentMonthData = {};
    const previousMonthData = {};
    const twoMonthsAgoData = {};

    processedTransactions.forEach(transaction => {
        const transactionDate = new Date(transaction.date);
        const transactionMonth = transactionDate.getMonth() + 1;
        const transactionYear = transactionDate.getFullYear();
        
        const key = type === 'category' ? 
            (transaction.category || 'Uncategorized') : 
            (transaction.merchant_name || 'Unknown');
        
        let targetData;
        if (transactionYear === year && transactionMonth === month) {
            targetData = currentMonthData;
        } else if (
            (transactionYear === year && transactionMonth === month - 1) ||
            (transactionYear === year - 1 && month === 1 && transactionMonth === 12)
        ) {
            targetData = previousMonthData;
        } else {
            targetData = twoMonthsAgoData;
        }

        if (!targetData[key]) {
            targetData[key] = 0;
        }
        targetData[key] += Math.abs(transaction.amount);
    });

    // Get all unique labels
    const labels = [...new Set([
        ...Object.keys(currentMonthData),
        ...Object.keys(previousMonthData),
        ...Object.keys(twoMonthsAgoData)
    ])];

    // Sort labels by current month values (descending)
    labels.sort((a, b) => 
        (currentMonthData[b] || 0) - (currentMonthData[a] || 0)
    );

    return {
        [type === 'category' ? 'categories' : 'merchants']: {
            labels,
            values: {
                current: labels.map(label => currentMonthData[label] || 0),
                previous: labels.map(label => previousMonthData[label] || 0),
                twoMonthsAgo: labels.map(label => twoMonthsAgoData[label] || 0)
            }
        }
    };
}

async function getChartData(familyid, accessToken, year, month) {
    // Get 3 months of transactions in one call
    const endDate = new Date(year, month, 0); // End of current month
    const startDate = new Date(year, month - 3, 1); // Start of 2 months ago

    try {
        // Fetch transactions and rules in parallel
        const [transactions, rules] = await Promise.all([
            getTransactionsByMonth(
                accessToken,
                plaidClient,
                startDate,
                endDate
            ),
            getIncomeExpenseRules(familyid)
        ]);

        const processedTransactions = await processTransactions(transactions, rules);

        // Separate transactions by month
        const currentMonthTxns = [];
        const previousMonthTxns = [];
        const twoMonthsAgoTxns = [];

        processedTransactions.filter(txn => txn.amount > 0).forEach(txn => {
            const txnDate = new Date(txn.date);
            const txnMonth = txnDate.getMonth() + 1;
            const txnYear = txnDate.getFullYear();

            if (txnYear === year && txnMonth === month) {
                currentMonthTxns.push(txn);
            } else if (
                (txnYear === year && txnMonth === month - 1) ||
                (txnYear === year - 1 && month === 1 && txnMonth === 12)
            ) {
                previousMonthTxns.push(txn);
            } else {
                twoMonthsAgoTxns.push(txn);
            }
        });
        console.log("transactions", transactions);
        console.log("currentMonthTxns", currentMonthTxns);
        console.log("previousMonthTxns", previousMonthTxns);
        
        // Set up date ranges
        const startOfRequestedMonth = new Date(year, month - 1, 1);
        const endOfRequestedMonth = new Date(year, month, 0);
        const startOfPreviousMonth = new Date(year, month - 2, 1);
        const endOfPreviousMonth = new Date(year, month - 1, 0);

        const cumulativeData = {
            currentMonthChartData: processMonthlyData(currentMonthTxns, startOfRequestedMonth, endOfRequestedMonth),
            previousMonthChartData: processMonthlyData(previousMonthTxns, startOfPreviousMonth, endOfPreviousMonth)
        };

        // 2. Prepare category data
        const getCategoryTotals = (transactions) => {
            return transactions.reduce((acc, txn) => {
                // First check for custom category, if not 'Uncategorized' use it
                const category = txn.customCategory && txn.customCategory !== 'Uncategorized'
                    ? txn.customCategory
                    : (txn.personal_finance_category?.primary || // Then try Plaid's primary category
                       (txn.category?.[0] || 'Uncategorized')); // Finally fall back to first Plaid category or 'Uncategorized'
                
                acc[category] = (acc[category] || 0) + Math.abs(txn.amount);
                return acc;
            }, {});
        };

        const currentCategoryTotals = getCategoryTotals(currentMonthTxns);
        const previousCategoryTotals = getCategoryTotals(previousMonthTxns);
        const twoMonthsAgoCategoryTotals = getCategoryTotals(twoMonthsAgoTxns);
        console.log("previousMonthTxns", previousMonthTxns);
        console.log("rules", rules);
        // Get all unique categories and sort by current month values
        const categories = [...new Set([
            ...Object.keys(currentCategoryTotals),
            ...Object.keys(previousCategoryTotals),
            ...Object.keys(twoMonthsAgoCategoryTotals)
        ])].sort((a, b) => (currentCategoryTotals[b] || 0) - (currentCategoryTotals[a] || 0));

        // 3. Prepare merchant data
        const getMerchantTotals = (transactions) => {
            return transactions.reduce((acc, txn) => {
                const merchant = txn.merchant_name || 'Unknown';
                acc[merchant] = (acc[merchant] || 0) + Math.abs(txn.amount);
                return acc;
            }, {});
        };

        const currentMerchantTotals = getMerchantTotals(currentMonthTxns);
        const previousMerchantTotals = getMerchantTotals(previousMonthTxns);
        const twoMonthsAgoMerchantTotals = getMerchantTotals(twoMonthsAgoTxns);

        // Get all unique merchants and sort by current month values
        const merchants = [...new Set([
            ...Object.keys(currentMerchantTotals),
            ...Object.keys(previousMerchantTotals),
            ...Object.keys(twoMonthsAgoMerchantTotals)
        ])].sort((a, b) => (currentMerchantTotals[b] || 0) - (currentMerchantTotals[a] || 0));

        return {
            currentMonthTransactions: currentMonthTxns,
            cumulative: cumulativeData,
            categories: {
                labels: categories,
                values: {
                    current: categories.map(cat => currentCategoryTotals[cat] || 0),
                    previous: categories.map(cat => previousCategoryTotals[cat] || 0),
                    twoMonthsAgo: categories.map(cat => twoMonthsAgoCategoryTotals[cat] || 0)
                }
            },
            merchants: {
                labels: merchants,
                values: {
                    current: merchants.map(mer => currentMerchantTotals[mer] || 0),
                    previous: merchants.map(mer => previousMerchantTotals[mer] || 0),
                    twoMonthsAgo: merchants.map(mer => twoMonthsAgoMerchantTotals[mer] || 0)
                }
            }
        };
    } catch (error) {
        console.error('Error getting chart data:', error);
        throw error;
    }
}

module.exports = { 
    getTransactions, 
    plaidClient, 
    syncTransactions, 
    getMonthlyOverview, 
    getTransactionsByMonth, 
    updateExpenseCategory, 
    getIncomeExpenseRules, 
    processTransactions, 
    processMonthlyData, 
    getPreviousMonthTransactions, 
    getLast12MonthsSavings,
    getAggregatedChartData,
    getChartData
 };
