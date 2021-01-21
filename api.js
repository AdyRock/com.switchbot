const Homey = require('homey');

module.exports = [

    {
        method: 'GET',
        path: '/',
        public: true,
        fn: async function (args, callback) {
            //const result = await Homey.app.getSomething( args );
            console.log("Get: ", args)

            // callback follows ( err, result )
            const result = "OK";
            callback(null, result);

            // access /?foo=bar as args.query.foo
        }
    },
    {
        method: 'GET',
        path: '/getLog/',
        fn: async function (args, callback) {
            return callback(null, Homey.app.diagLog);
        }
    },
    {
        method: 'GET',
        path: '/getDetect/',
        fn: async function (args, callback) {
            return callback(null, Homey.app.detectedDevices);
        }
    },

    {
        method: 'POST',
        path: '/clearLog/',
        fn: function (args, callback) {
            Homey.app.diagLog = "";
            return callback(null, "ok");
        }
    },
    {
        method: 'POST',
        path: '/',
        public: true,
        fn: function (args, callback) {
            //const result = Homey.app.addSomething( args );
            console.log("Post: ", args)

            var response = "";
            const result = response;
            console.log("Post Reply: ", result)
            if (result instanceof Error) return callback(result);
            return callback(null, result);
        }
    },

]