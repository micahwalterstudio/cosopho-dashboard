const GraphQL = require('../../classes/graphQL')
const Queries = require('../../classes/queries')
const Mutations = require('../../classes/mutations')
const Config = require('../../classes/config')

const paginator = (pagination, target, range) => {
  pagination.showStartEllipses = false
  pagination.showEndEllipses = false
  pagination.showEllipses = false
  pagination.showPrevious = true
  pagination.showNext = true

  pagination.page += 1
  pagination.maxPage += 1

  if (pagination.page - range - 1 <= 1) {
    pagination.startPage = 1
  } else {
    pagination.startPage = pagination.page - range
    pagination.showStartEllipses = true
    pagination.showEllipses = true
  }

  if (pagination.page + range + 1 >= pagination.maxPage) {
    pagination.endPage = pagination.maxPage
  } else {
    pagination.endPage = pagination.page + range
    pagination.showEndEllipses = true
    pagination.showEllipses = true
  }

  if (pagination.page <= 1) pagination.showPrevious = false
  if (pagination.page >= pagination.maxPage) pagination.showNext = false
  pagination.pageLoop = Array.from(Array(pagination.endPage - pagination.startPage + 1), (_, x) => x + pagination.startPage)
  pagination.previousPage = pagination.page - 1
  pagination.nextPage = pagination.page + 1
  pagination.target = target
  return pagination
}
exports.paginator = paginator

const getStrings = async (key, instance) => {
  const graphQL = new GraphQL()
  const queries = new Queries()

  let allStrings = []
  let strings = [null]
  let page = 0
  let perPage = 1000

  while (strings.length !== 0) {
    let stringsQuery = queries.get('strings', `(instances: ["${key}", "${instance}"], page: ${page}, per_page: ${perPage})`)
    strings = await graphQL.fetch({
      query: stringsQuery
    }, process.env.HANDSHAKE)

    if (strings.data && strings.data.strings) {
      strings = strings.data.strings
    }

    if (strings.length > 0) {
      allStrings = allStrings.concat(strings)
    }
    page++
  }

  const masterStrings = allStrings.filter((string) => {
    const idSplit = string.id.split('.')
    const key = idSplit[0]
    return key === process.env.KEY
  })
  const localStrings = allStrings.filter((string) => {
    const idSplit = string.id.split('.')
    const key = idSplit[0]
    return key !== process.env.KEY
  })
  //  Build up the whole object
  const newI18n = {}
  masterStrings.forEach((record) => {
    const tokenSplit = record.token.split('.')
    const section = tokenSplit[1]
    const stub = tokenSplit[2]
    if (!newI18n[section]) newI18n[section] = {}
    if (!newI18n[section][stub]) newI18n[section][stub] = {}
    if (!newI18n[section][stub][record.language]) newI18n[section][stub][record.language] = record.string
  })

  //  Now overwrite any we have translated to the local strings
  localStrings.forEach((record) => {
    const tokenSplit = record.token.split('.')
    const section = tokenSplit[1]
    const stub = tokenSplit[2]
    if (newI18n[section][stub][record.language]) newI18n[section][stub][record.language] = record.string
  })

  return newI18n
}
exports.getStrings = getStrings

const getAllStrings = async (key, instance) => {
  const graphQL = new GraphQL()
  const queries = new Queries()

  let allStrings = []
  let strings = [null]
  let page = 0
  let perPage = 1000

  while (strings.length !== 0) {
    let stringsQuery = queries.get('strings', `(page: ${page}, per_page: ${perPage})`)
    strings = await graphQL.fetch({
      query: stringsQuery
    }, process.env.HANDSHAKE)

    if (strings.data && strings.data.strings) {
      strings = strings.data.strings
    }

    if (strings.length > 0) {
      allStrings = allStrings.concat(strings)
    }
    page++
  }

  allStrings = allStrings.map((record) => {
    return {
      id: record.id,
      instance: record.instance,
      section: record.section,
      stub: record.stub,
      token: record.token,
      language: record.language,
      string: record.string
    }
  })
  return allStrings
}
exports.getAllStrings = getAllStrings

const getInstanceLangStrings = async (instance, languages) => {
  const graphQL = new GraphQL()
  const queries = new Queries()

  let allStrings = []
  let strings = [null]
  let page = 0
  let perPage = 1000

  while (strings.length !== 0) {
    let stringsQuery = queries.get('stringsShort', `(instance: "${instance}", language: ${languages}, page: ${page}, per_page: ${perPage})`)
    try {
      strings = await graphQL.fetch({
        query: stringsQuery
      }, process.env.HANDSHAKE)
    } catch (er) {
      strings = []
    }

    if (strings.data && strings.data.strings) {
      strings = strings.data.strings
      if (strings.length > 0) {
        allStrings = allStrings.concat(strings)
      }
    } else {
      strings = []
    }
    page++
  }

  return allStrings
}
exports.getInstanceLangStrings = getInstanceLangStrings

//  This sends all the strings back to the database one by one
const reloadStrings = async (deleteFirst, strings) => {
  const graphQL = new GraphQL()
  const mutations = new Mutations()
  const configObj = new Config()

  //  If we have been told to delete all the strings then we do that here
  let mutation = null
  if (deleteFirst) {
    mutation = mutations.get('deleteAllStrings', ``)
    const payload = {
      query: mutation
    }
    const results = await graphQL.fetch(payload, configObj.get('handshake'))
    console.log(results)
  }

  const thisString = strings.pop()

  mutation = mutations.get('createString', `(section: "${thisString.section}", stub: "${thisString.stub}", language: "${thisString.language}", string:"${escape(thisString.string.trim())}")`)
  const payload = {
    query: mutation
  }
  await graphQL.fetch(payload, configObj.get('handshake'))

  if (strings.length > 0) {
    setTimeout(() => {
      reloadStrings(false, strings)
    }, 1000)
  }
}
exports.reloadStrings = reloadStrings

const makeCSV = async (instance, page = 0) => {
  const graphQL = new GraphQL()
  const queries = new Queries()

  if (!global.csvs) global.csvs = {}
  if (!global.csvs[instance]) {
    global.csvs[instance] = {
      progress: {
        status: 'started',
        lastTick: new Date(),
        finished: false,
        page,
        maxPage: null,
        photos: {
          page: {}
        }
      }
    }
  }

  global.csvs[instance].progress.page = page
  //  Grab the photos based on this page
  let allPhotos = null
  let perPage = 250
  let photosQuery = queries.get('photos', `(instance: "${instance}", sort: "desc", sort_field: "uploaded", page: ${page}, per_page: ${perPage})`)
  allPhotos = await graphQL.fetch({
    query: photosQuery
  }, process.env.HANDSHAKE)

  let photos = null
  if (allPhotos.data && allPhotos.data.photos) {
    photos = allPhotos.data.photos.map((photo) => {
      if (photo.tags) {
        if (Array.isArray(photo.tags)) {
          photo.tags = photo.tags.join(', ')
        } else {
          photo.tags = [photo.tags]
        }
      }
      return photo
    })
    global.csvs[instance].progress.photos.page[page] = photos
    global.csvs[instance].progress.status = 'running'
    global.csvs[instance].progress.lastTick = new Date()
    if (photos.length && photos[0]._sys && photos[0]._sys.pagination) {
      global.csvs[instance].progress.maxPage = photos[0]._sys.pagination.maxPage
      if (photos[0]._sys.pagination.page < photos[0]._sys.pagination.maxPage) {
        setTimeout(() => {
          makeCSV(instance, ++page)
        }, 500)
      } else {
        global.csvs[instance].progress.status = 'finished'
        global.csvs[instance].progress.finished = true
      }
    }
  }
}
exports.makeCSV = makeCSV
