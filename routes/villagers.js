const express = require('express');
const router = express.Router();
const formatUtil = require('../db/util/format.js');

/**
 * Number of entities per page on any result page.
 *
 * @type {number}
 */
const pageSize = 25;

/**
 * Load villagers on a particular page number with a particular search query.
 *
 * @param collection collection of villagers from Mongo
 * @param es
 * @param pageNumber the already sanity checked page number
 * @param searchQuery
 * @returns {Promise<void>}
 */
async function find(collection, es, pageNumber, searchQuery) {
    const result = {};

    // Is it a search? Initialize result and ES body appropriately
    let body;
    let query;
    if (searchQuery) {
        // Set up result set for search display
        result.pageUrlPrefix = '/villagers/search/page/';
        result.isSearch = true;
        result.searchQuery = searchQuery;
        result.searchQueryString = encodeURI(searchQuery);

        // Elastic Search query and body.
        query = {
            bool: {
                should: [
                    {
                        match: {
                            name: {
                                query: searchQuery
                            }
                        }
                    },
                    {
                        match: {
                            phrase: {
                                query: searchQuery,
                                fuzziness: 'auto'
                            }
                        }
                    }
                ]
            }
        };

        body =  {
            sort: [
                "_score",
                {
                    keyword: "asc"
                }
            ],
            query: query,
            aggregations: {
                genders: {
                    terms: {
                        field: 'gender'
                    }
                },
                personalities: {
                    terms: {
                        field: 'personality'
                    }
                },
                species: {
                    terms: {
                        field: 'species'
                    }
                },
                games: {
                    terms: {
                        field: 'game'
                    }
                }
            },
        };
    } else {
        result.pageUrlPrefix = '/villagers/page/';

        // Elastic Search query and body.
        query = {
            match_all: {}
        };

        body = {
            sort: [
                {
                    keyword: "asc"
                }
            ],
            query: query
        }
    }

    // Count.
    const totalCount = await es.count({
        index: 'villager',
        body: {
            query: query
        }
    });

    // Update page information.
    computePageProperties(pageNumber, pageSize, totalCount.count, result);

    if (totalCount.count) {
        // Load all on this page.
        const results = await es.search({
            index: 'villager',
            from: pageSize * (result.currentPage - 1),
            size: pageSize,
            body: body
        });

        // Load the results.
        const keys = results.hits.hits.map(hit => hit._id);
        const rawResults = await collection.getByIds(keys);
        result.results = [];
        for (let r of rawResults) {
            result.results.push({
                id: r.id,
                name: r.name
            });
        }
    }

    return result;
}



/**
 * Return the given input as a parsed integer if it is a positive integer. Otherwise, return 1.
 *
 * @param value
 * @returns {number}
 */
function parsePositiveInteger(value) {
    const parsedValue = parseInt(value);
    if (Number.isNaN(parsedValue) || parsedValue < 1) {
        return 1;
    }

    return parsedValue;
}

/**
 * Return a search query, trimmed, or undefined if there really isn't a usable one.
 *
 * @param value
 * @returns {string}
 */
function parseQuery(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
}

/**
 * Do pagination math.
 *
 * @param pageNumber
 * @param pageSize
 * @param totalCount
 * @param result
 */
function computePageProperties(pageNumber, pageSize, totalCount, result) {
    // Totals
    result.totalCount = totalCount;
    result.totalPages = Math.ceil(totalCount / pageSize);

    // Clean up page number.
    if (pageNumber < 1) {
        pageNumber = 1;
    } else if (pageNumber > result.totalPages) {
        pageNumber = result.totalPages;
    }

    // Pagination specifics
    result.currentPage = pageNumber;
    result.startIndex = (pageSize * (pageNumber - 1) + 1);
    result.endIndex = (pageSize * pageNumber) > totalCount ? totalCount :
        (pageSize * pageNumber);
}
/**
 * Villager list and search entry point.
 *
 * @param res
 * @param next
 * @param pageNumber
 * @param searchQuery
 */
function listVillagers(res, next, pageNumber, isAjax, searchQuery) {
    const data = {};
    if (searchQuery) {
        data.pageTitle = 'Search results for ' + searchQuery; // template engine handles HTML escape
    } else {
        data.pageTitle = 'All Villagers - Page ' + pageNumber;
    }

    find(res.app.locals.db.villagers, res.app.locals.es, pageNumber, searchQuery)
        .then((result) => {
            if (isAjax) {
                res.send(result);
            } else {
                data.initialState = JSON.stringify(result);
                res.render('villagers', data);
            }
        }).catch(next);
}

/* GET villagers listing. */
router.get('/', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true');
});

/* GET villagers page number */
router.get('/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true');
});

/* GET villagers search */
router.get('/search', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true', parseQuery(req.query.q));
});

/* GET villagers search page number */
router.get('/search/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true', parseQuery(req.query.q));
});

module.exports = router;